import { db } from "@/lib/db";
import { github, type GhJob, type GitHubApi } from "@/lib/github/client";
import { requireRepoAccess } from "@/lib/github/access";
import { isActive } from "./state";

// What a person watching a run sees: the handful of stages the workflow goes through, which one is happening now,
// and how long the run and that stage have been going. Built from the steps GitHub reports for the workflow run
// (the step names are the ones in the workflow template, src/lib/runs/workflow.ts).

export type StageId = "prepare" | "ai" | "handover" | "test" | "save" | "pr";
export type Stage = { id: StageId; label: string; state: "done" | "active" | "waiting"; startedAt: string | null };

export const STAGES: { id: StageId; label: string }[] = [
  { id: "prepare", label: "Getting your code ready" },
  { id: "ai", label: "The AI works on the change" },
  { id: "handover", label: "Handing the changes over" },
  { id: "test", label: "Running your build and tests" },
  { id: "save", label: "Saving the branch" },
  { id: "pr", label: "Opening the pull request" },
];

const IGNORED = /^(post |complete job)/i;

export function stageOf(job: string, step: string): StageId | null {
  if (IGNORED.test(step)) return null;
  if (/push branch|report result/i.test(step)) return "save";
  if (/verify|apply the ai/i.test(step)) return "test";
  if (/run claude code|run codex/i.test(step)) return "ai";
  if (/hand over|upload the ai/i.test(step)) return "handover";
  // The second job (v8 and later) only applies, tests and saves; the first one gets the code ready.
  return job === "publish" ? "test" : "prepare";
}

// `jobs` null: GitHub has not started the workflow yet (or could not be asked). The first stage is then shown as
// the one under way, because the run was already handed to GitHub.
export function stagesFrom(jobs: GhJob[] | null): Stage[] {
  const steps = (jobs ?? []).flatMap((j) => j.steps.map((s) => ({ ...s, stage: stageOf(j.name, s.name) }))).filter((s) => s.stage);
  const stages: Stage[] = STAGES.map(({ id, label }) => {
    const own = steps.filter((s) => s.stage === id);
    const started = own.map((s) => s.startedAt).filter((x): x is string => !!x).sort()[0] ?? null;
    if (!own.length) return { id, label, state: "waiting", startedAt: null };
    if (own.some((s) => s.status === "in_progress")) return { id, label, state: "active", startedAt: started };
    if (own.every((s) => s.status === "completed")) return { id, label, state: "done", startedAt: started };
    if (own.some((s) => s.status === "completed")) return { id, label, state: "active", startedAt: started };
    return { id, label, state: "waiting", startedAt: null };
  });
  // The last stage (opening the pull request) is Idea HQ's own and has no step: it is the one under way once the
  // workflow's own stages are all done.
  const lastReal = stages.length - 1;
  if (stages.slice(0, lastReal).every((s) => s.state === "done")) stages[lastReal] = { ...stages[lastReal], state: "active" };
  // Nothing reported as under way (between two steps, or not started): the first stage not done is.
  if (!stages.some((s) => s.state === "active")) {
    const next = stages.findIndex((s) => s.state !== "done");
    if (next >= 0) stages[next] = { ...stages[next], state: "active" };
  }
  return stages;
}

export type Progress = {
  active: boolean;
  elapsedMs: number | null;
  stages: Stage[] | null;
  stageElapsedMs: number | null;
};

// GitHub is asked at most about once every few seconds per run, however many tabs are open.
const TTL_MS = 6000;
const cache = new Map<string, { at: number; stages: Stage[] }>();

export async function getRunProgress(userId: string, runId: string, deps?: { gh?: GitHubApi; now?: () => Date }): Promise<Progress | null> {
  const run = await db.run.findFirst({ where: { id: runId, userId }, include: { project: true } });
  if (!run) return null;
  if (!isActive(run.status)) return { active: false, elapsedMs: null, stages: null, stageElapsedMs: null };

  // Same rule as every other use of the project's repository: only someone who can open it on GitHub.
  await requireRepoAccess(run.project);

  const now = (deps?.now?.() ?? new Date()).getTime();
  const since = (run.startedAt ?? run.createdAt).getTime();
  const p = run.project;
  let stages: Stage[];
  const key = `${run.id}:${run.ghRunId ?? ""}`; // a new workflow run (a revision) starts afresh
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) {
    stages = hit.stages;
  } else {
    let jobs: GhJob[] | null = null;
    if (run.ghRunId && p.installationId && p.repoOwner && p.repoName) {
      jobs = await (deps?.gh ?? github).runJobs(p.installationId, p.repoOwner, p.repoName, run.ghRunId).catch(() => null);
    }
    stages = stagesFrom(jobs && jobs.length ? jobs : null);
    cache.set(key, { at: now, stages });
    if (cache.size > 200) for (const k of Array.from(cache.keys()).slice(0, 100)) cache.delete(k);
  }
  const current = stages.find((s) => s.state === "active");
  const stageStart = current?.startedAt ? Date.parse(current.startedAt) : NaN;
  return {
    active: true,
    elapsedMs: Math.max(0, now - since),
    stages,
    stageElapsedMs: Number.isFinite(stageStart) ? Math.max(0, now - stageStart) : null,
  };
}
