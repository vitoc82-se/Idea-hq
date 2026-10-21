import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeFakeDb } from "./fakedb";
import type { GhJob, GhStep, GitHubApi } from "@/lib/github/client";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));

const access = vi.hoisted(() => ({ refuse: false }));
vi.mock("@/lib/github/access", () => ({
  requireRepoAccess: async () => { if (access.refuse) throw new Error("no access"); },
}));

import { stagesFrom, getRunProgress, STAGES } from "@/lib/runs/progress";
import { clock, RunProgress } from "@/app/(app)/ideas/run-progress";
import { buildWorkflow } from "@/lib/runs/workflow";

const step = (name: string, status: GhStep["status"], startedAt: string | null = null): GhStep => ({ name, status, conclusion: status === "completed" ? "success" : null, startedAt, completedAt: null });
const IMPLEMENT = (ai: GhStep["status"], after: GhStep["status"] = "queued"): GhJob => ({
  name: "implement", status: "in_progress", conclusion: null, startedAt: "2026-10-22T10:00:00Z", completedAt: null,
  steps: [
    step("Set up job", "completed", "2026-10-22T10:00:01Z"),
    step("Check out the working branch", "completed", "2026-10-22T10:00:05Z"),
    step("Install dependencies", "completed", "2026-10-22T10:00:20Z"),
    step("Install the shell sandbox tools", "completed", "2026-10-22T10:00:40Z"),
    step("Run Claude Code", ai, "2026-10-22T10:01:00Z"),
    step("Hand over the AI's changes", after, after === "queued" ? null : "2026-10-22T10:09:00Z"),
    step("Upload the AI's changes", after),
    step("Complete job", "queued"),
  ],
});
const PUBLISH = (verify: GhStep["status"], push: GhStep["status"] = "queued"): GhJob => ({
  name: "publish", status: "in_progress", conclusion: null, startedAt: "2026-10-22T10:09:30Z", completedAt: null,
  steps: [
    step("Set up job", "completed", "2026-10-22T10:09:31Z"),
    step("Apply the AI's changes", "completed", "2026-10-22T10:09:40Z"),
    step("Verify (build and tests)", verify, "2026-10-22T10:09:50Z"),
    step("Push branch", push),
    step("Report result", push),
  ],
});
const states = (jobs: GhJob[] | null) => stagesFrom(jobs).map((s) => `${s.id}:${s.state}`);

describe("stagesFrom: which stage a run is in, from GitHub's steps", () => {
  it("shows the first stage as under way before GitHub has reported anything", () => {
    expect(states(null)).toEqual(["prepare:active", "ai:waiting", "handover:waiting", "test:waiting", "save:waiting", "pr:waiting"]);
  });
  it("marks the AI stage as under way while Run Claude Code runs, and the earlier one done", () => {
    expect(states([IMPLEMENT("in_progress")])).toEqual(["prepare:done", "ai:active", "handover:waiting", "test:waiting", "save:waiting", "pr:waiting"]);
  });
  it("also understands the OpenAI step", () => {
    const job = IMPLEMENT("in_progress");
    job.steps[4] = step("Run Codex", "in_progress", "2026-10-22T10:01:00Z");
    expect(stagesFrom([job]).find((s) => s.state === "active")?.id).toBe("ai");
  });
  it("moves on through handing over, testing and saving", () => {
    expect(states([IMPLEMENT("completed", "in_progress")])[2]).toBe("handover:active");
    expect(states([IMPLEMENT("completed", "completed"), PUBLISH("in_progress")])).toEqual(["prepare:done", "ai:done", "handover:done", "test:active", "save:waiting", "pr:waiting"]);
    expect(states([IMPLEMENT("completed", "completed"), PUBLISH("completed", "in_progress")])).toEqual(["prepare:done", "ai:done", "handover:done", "test:done", "save:active", "pr:waiting"]);
  });
  it("ends on opening the pull request once the workflow's own stages are done", () => {
    const publish = PUBLISH("completed", "completed");
    expect(states([IMPLEMENT("completed", "completed"), publish])).toEqual(["prepare:done", "ai:done", "handover:done", "test:done", "save:done", "pr:active"]);
  });
  it("always has exactly one stage under way, even between two steps", () => {
    const between = IMPLEMENT("completed", "queued"); // the AI is done, the next step has not started
    const s = stagesFrom([between]);
    expect(s.filter((x) => x.state === "active")).toHaveLength(1);
    expect(s.find((x) => x.state === "active")?.id).toBe("handover");
  });
  it("gives the active stage the time its first step started", () => {
    expect(stagesFrom([IMPLEMENT("in_progress")]).find((s) => s.id === "ai")?.startedAt).toBe("2026-10-22T10:01:00Z");
  });
  it("ignores clean-up steps", () => {
    const job = IMPLEMENT("in_progress");
    job.steps.push(step("Post Run actions/checkout@v4", "queued"));
    expect(states([job])[0]).toBe("prepare:done");
  });
  it("covers every step name the workflow template really has", () => {
    const wf = buildWorkflow({ appSlug: "idea-hq", buildCommand: "npm run build", testCommand: "npm test" });
    const names = Array.from(wf.matchAll(/^\s+- name: (.+)$/gm)).map((m) => m[1]).filter((n) => !/\$\{\{/.test(n));
    expect(names.length).toBeGreaterThan(8);
    const known = ["Check out the working branch", "Install dependencies", "Install the shell sandbox tools", "Run Claude Code", "Run Codex", "Hand over the AI's changes", "Upload the AI's changes", "Download the AI's changes", "Apply the AI's changes", "Verify (build and tests)", "Push branch", "Report result"];
    for (const n of names) expect(known, `a step named "${n}" is not mapped to a stage`).toContain(n);
    expect(STAGES.map((s) => s.id)).toEqual(["prepare", "ai", "handover", "test", "save", "pr"]);
  });
});

describe("getRunProgress", () => {
  let t: ReturnType<typeof makeFakeDb>;
  const NOW = new Date("2026-10-22T10:05:00Z");
  let calls: number;
  const gh = (jobs: GhJob[]) => ({ runJobs: async () => { calls++; return jobs; } }) as unknown as GitHubApi;
  beforeEach(() => {
    t = makeFakeDb();
    holder.db = t.db;
    calls = 0;
    access.refuse = false;
    t.tables.project.push({ id: "p1", userId: "u1", name: "P", installationId: 5, repoOwner: "acme", repoName: "app" });
    t.tables.run.push({ id: "R1", userId: "u1", projectId: "p1", status: "running", ghRunId: "99", startedAt: new Date("2026-10-22T10:00:00Z"), createdAt: new Date("2026-10-22T09:59:00Z") });
  });

  it("returns the stages, how long the run has been going, and how long the current stage has", async () => {
    const p = await getRunProgress("u1", "R1", { gh: gh([IMPLEMENT("in_progress")]), now: () => NOW });
    expect(p).toMatchObject({ active: true, elapsedMs: 5 * 60 * 1000, stageElapsedMs: 4 * 60 * 1000 });
    expect(p?.stages?.find((s) => s.state === "active")?.id).toBe("ai");
  });
  it("is only for the run's owner", async () => {
    expect(await getRunProgress("u2", "R1", { gh: gh([]), now: () => NOW })).toBeNull();
  });
  it("is refused when the person can no longer open the repository, and asks GitHub nothing", async () => {
    access.refuse = true;
    await expect(getRunProgress("u1", "R1", { gh: gh([IMPLEMENT("in_progress")]), now: () => NOW })).rejects.toThrow("no access");
    expect(calls).toBe(0);
  });
  it("says a finished run is not active, without asking GitHub", async () => {
    t.tables.run[0].status = "pr_open";
    const p = await getRunProgress("u1", "R1", { gh: gh([]), now: () => NOW });
    expect(p).toEqual({ active: false, elapsedMs: null, stages: null, stageElapsedMs: null });
    expect(calls).toBe(0);
  });
  it("shows the first stage, and does not ask GitHub, before the workflow run is known", async () => {
    t.tables.run[0].ghRunId = null;
    const p = await getRunProgress("u1", "R1", { gh: gh([]), now: () => NOW });
    expect(p?.stages?.[0]).toMatchObject({ id: "prepare", state: "active" });
    expect(calls).toBe(0);
  });
  it("still answers when GitHub cannot be reached", async () => {
    const broken = { runJobs: async () => { throw new Error("down"); } } as unknown as GitHubApi;
    t.tables.run[0].id = "R2";
    const p = await getRunProgress("u1", "R2", { gh: broken, now: () => NOW });
    expect(p?.active).toBe(true);
    expect(p?.stages?.[0].state).toBe("active");
  });
  it("asks GitHub at most about once every few seconds per run", async () => {
    t.tables.run[0].id = "R3";
    await getRunProgress("u1", "R3", { gh: gh([IMPLEMENT("in_progress")]), now: () => NOW });
    await getRunProgress("u1", "R3", { gh: gh([IMPLEMENT("in_progress")]), now: () => new Date(NOW.getTime() + 2000) });
    expect(calls).toBe(1);
    await getRunProgress("u1", "R3", { gh: gh([IMPLEMENT("in_progress")]), now: () => new Date(NOW.getTime() + 8000) });
    expect(calls).toBe(2);
  });
});

describe("the progress view", () => {
  it("writes the clock as m:ss, and h:mm:ss past an hour", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65_000)).toBe("1:05");
    expect(clock(10 * 60_000 + 9_000)).toBe("10:09");
    expect(clock(3_725_000)).toBe("1:02:05");
    expect(clock(-5)).toBe("0:00");
  });
  it("renders a timer, a first look at the stages and the reassurance line", () => {
    const html = renderToStaticMarkup(createElement(RunProgress, { runId: "R1", startedAt: null }));
    expect(html).toContain("Working for");
    expect(html).toContain("You can leave this page");
    expect(html).toContain("Asking GitHub");
  });
  it("is shown in the run panel while a run is busy, and the list sends startedAt", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    expect(read("src/app/(app)/ideas/run-panel.tsx")).toMatch(/BUSY\.includes\(run\.status\) && <RunProgress/);
    expect(read("src/app/api/ideas/[id]/runs/route.ts")).toContain("startedAt: true");
  });
});
