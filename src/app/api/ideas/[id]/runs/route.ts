import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { readSteps } from "@/lib/runs/owner-steps";
import { startRun, reconcileRun, recommendForRun } from "@/lib/runs/engine";
import { getProvider } from "@/lib/providers";
import { buildAccess } from "@/lib/billing";
import { capState, capMessage } from "@/lib/spend";
import { effectiveSize } from "@/lib/runs/size";
import { loadHistory } from "@/lib/runs/history-store";
import { github, type GhPrChanges } from "@/lib/github/client";
import { requireRepoAccess } from "@/lib/github/access";

const PUBLIC = {
  id: true, kind: true, status: true, env: true, baseBranch: true, branch: true, prNumber: true,
  checksState: true, agentNote: true, previewUrl: true, costUsd: true, stageMs: true, turns: true, provider: true, model: true, effort: true, maxTurns: true, error: true, createdAt: true, startedAt: true, finishedAt: true, parentRunId: true,
} as const;

// What a pull request changes is read once per version of it (a revision makes a new one), not on every refresh.
const changesCache = new Map<string, ReturnType<typeof summarizeChanges>>();
const CHANGES_CACHE_MAX = 200;

// The biggest files first, a handful of them: the card says "and N more" for the rest.
function summarizeChanges(c: GhPrChanges) {
  const files = [...c.files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).slice(0, 6).map((f) => ({ name: f.name.slice(0, 120), additions: f.additions, deletions: f.deletions }));
  return { files, more: Math.max(0, c.totalFiles - files.length), totalFiles: c.totalFiles, additions: c.additions, deletions: c.deletions, truncated: c.truncated };
}

async function changesFor(key: string, load: () => Promise<GhPrChanges>) {
  const hit = changesCache.get(key);
  if (hit) return hit;
  const summary = summarizeChanges(await load());
  if (changesCache.size >= CHANGES_CACHE_MAX) changesCache.delete(changesCache.keys().next().value as string);
  changesCache.set(key, summary);
  return summary;
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const idea = await db.idea.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, projectId: true, title: true, complexity: true, ownerSteps: true, project: { select: { aiProvider: true, aiBias: true, name: true } } } });
    if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });

    // Epic: when the idea is split into stories, show them and which one is next.
    const kids = await db.idea.findMany({
      where: { parentId: idea.id, userId: auth.userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, status: true, complexity: true, plan: true, blockedBy: true },
    });
    const doneIds = new Set(kids.filter((k) => k.status === "done").map((k) => k.id));
    const next = kids.find((k) => k.status !== "done" && k.blockedBy.every((b) => doneIds.has(b)));
    const epic = kids.length
      ? {
          children: kids.map((k) => ({ id: k.id, title: k.title, status: k.status, complexity: k.complexity, hasPlan: !!k.plan })),
          nextId: next?.id ?? null,
        }
      : null;
    const active = await db.run.findMany({
      where: { ideaId: idea.id, userId: auth.userId, status: { in: ["dispatched", "running", "pr_open"] } },
      select: { id: true },
    });
    for (const r of active) await reconcileRun(r.id).catch(() => undefined);
    const runs = await db.run.findMany({
      where: { ideaId: idea.id, userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        ...PUBLIC,
        project: { select: { repoOwner: true, repoName: true, autoMerge: true } },
      },
    });
    // The waiting run also carries the tier we would pick, so the UI can show it.
    let recommended = null;
    const waiting = runs.find((r) => r.status === "awaiting_approval");
    if (waiting) {
      const full = await db.run.findFirst({
        where: { id: waiting.id, userId: auth.userId },
        include: { project: true, idea: true },
      });
      if (full) recommended = await recommendForRun(full);
    }
    // With no run waiting, the journey card still shows what a new run would use, so its Build button can say what it costs.
    if (!recommended && idea.project) {
      recommended = await recommendForRun({ ideaId: idea.id, userId: auth.userId, id: "preview", project: { aiBias: idea.project.aiBias, aiProvider: idea.project.aiProvider }, idea: { complexity: idea.complexity, title: idea.title } });
    }
    // The open pull request: which checks failed (so the "fix it" request can name them) and what it changes (so the
    // owner can read the change before merging). Same rule as every other use of the project's repository.
    let failingChecks: string[] = [];
    let changes: ReturnType<typeof summarizeChanges> | null = null;
    const open = runs.find((r) => r.status === "pr_open" && r.kind === "implement");
    if (open) {
      try {
        const full = await db.run.findFirst({ where: { id: open.id, userId: auth.userId }, include: { project: true } });
        const p = full?.project;
        if (p) await requireRepoAccess(p);
        if (full && p?.installationId && p.repoOwner && p.repoName) {
          if (open.checksState === "red" && full.headSha) {
            failingChecks = (await github.checkSummary(p.installationId, p.repoOwner, p.repoName, full.headSha, true)).failing.slice(0, 8).map((n) => n.slice(0, 80));
          }
          if (full.prNumber) changes = await changesFor(`${full.id}:${full.headSha ?? ""}`, () => github.prChanges(p.installationId!, p.repoOwner!, p.repoName!, full.prNumber!));
        }
      } catch {
        failingChecks = [];
        changes = null;
      }
    }
    // What this person's own finished runs took, by size, shown next to the default ranges. The page asks for it once;
    // the poll while a run is going (?poll=1) does not need it again.
    const history = new URL(req.url).searchParams.has("poll") ? undefined : await loadHistory(auth.userId).catch(() => ({}));
    const prov = getProvider(idea.project?.aiProvider);
    const access = await buildAccess(auth.userId);
    const cap = await capState(idea.projectId);
    return NextResponse.json({
      capReached: cap.reached ? capMessage(idea.project?.name ?? "this project", cap) : null, // a plain sentence when the monthly cap is used up
      runs, recommended, epic, failingChecks, changes, history,
      ownerSteps: readSteps(idea.ownerSteps), // setup steps only the owner can do, ticked or not
      aiBuild: access.ok || access.reason !== "off", // false: show a notice instead of the AI build buttons
      needsPlan: !access.ok && access.reason === "needs_plan", // paywall: no Pro and no credits left
      sized: !!effectiveSize(idea), // the AI only implements an idea that has a size
      models: prov.models,
      efforts: prov.efforts,
      provider: { id: prov.id, label: prov.label, reportsCost: prov.reportsCost, supportsTurnCap: prov.supportsTurnCap },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// "Implement": creates a run that waits for plan approval.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const run = await startRun(auth.userId, params.id);
    return NextResponse.json({ run: { id: run.id, status: run.status, plan: run.plan, env: run.env, baseBranch: run.baseBranch } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
