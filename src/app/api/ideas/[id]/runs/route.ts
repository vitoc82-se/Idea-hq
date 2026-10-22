import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { startRun, reconcileRun, recommendForRun } from "@/lib/runs/engine";
import { getProvider } from "@/lib/providers";
import { buildAccess } from "@/lib/billing";
import { capState, capMessage } from "@/lib/spend";
import { effectiveSize } from "@/lib/runs/size";
import { github } from "@/lib/github/client";
import { requireRepoAccess } from "@/lib/github/access";

const PUBLIC = {
  id: true, kind: true, status: true, env: true, baseBranch: true, branch: true, prNumber: true,
  checksState: true, agentNote: true, previewUrl: true, costUsd: true, turns: true, provider: true, model: true, effort: true, maxTurns: true, error: true, createdAt: true, startedAt: true, finishedAt: true, parentRunId: true,
} as const;

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const idea = await db.idea.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, projectId: true, title: true, complexity: true, project: { select: { aiProvider: true, aiBias: true, name: true } } } });
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
    const open = await db.run.findMany({
      where: { ideaId: idea.id, userId: auth.userId, status: { in: ["dispatched", "running", "pr_open"] } },
      select: { id: true },
    });
    for (const r of open) await reconcileRun(r.id).catch(() => undefined);
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
    // When a pull request's checks failed: which ones, so the "fix it" request can name them.
    let failingChecks: string[] = [];
    const red = runs.find((r) => r.status === "pr_open" && r.checksState === "red" && r.kind === "implement");
    if (red) {
      try {
        const full = await db.run.findFirst({ where: { id: red.id, userId: auth.userId }, include: { project: true } });
        const p = full?.project;
        if (p) await requireRepoAccess(p); // same rule as every other use of the project's repository
        if (full?.headSha && p?.installationId && p.repoOwner && p.repoName) {
          failingChecks = (await github.checkSummary(p.installationId, p.repoOwner, p.repoName, full.headSha, true)).failing.slice(0, 8).map((n) => n.slice(0, 80));
        }
      } catch {
        failingChecks = [];
      }
    }
    const prov = getProvider(idea.project?.aiProvider);
    const access = await buildAccess(auth.userId);
    const cap = await capState(idea.projectId);
    return NextResponse.json({
      capReached: cap.reached ? capMessage(idea.project?.name ?? "this project", cap) : null, // a plain sentence when the monthly cap is used up
      runs, recommended, epic, failingChecks,
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
