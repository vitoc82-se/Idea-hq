import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { startRun, reconcileRun, recommendForRun } from "@/lib/runs/engine";
import { getProvider } from "@/lib/providers";
import { aiBuildAllowed } from "@/lib/access";

const PUBLIC = {
  id: true, kind: true, status: true, env: true, baseBranch: true, branch: true, prNumber: true,
  checksState: true, costUsd: true, turns: true, provider: true, model: true, effort: true, maxTurns: true, error: true, createdAt: true, finishedAt: true, parentRunId: true,
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const idea = await db.idea.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, project: { select: { aiProvider: true } } } });
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
    const prov = getProvider(idea.project?.aiProvider);
    return NextResponse.json({
      runs, recommended, epic,
      aiBuild: await aiBuildAllowed(auth.userId), // false: show a notice instead of the AI build buttons
      models: prov.models,
      efforts: prov.efforts,
      provider: { id: prov.id, label: prov.label, reportsCost: prov.reportsCost, supportsTurnCap: prov.supportsTurnCap },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// "Implement": creates a run that waits for plan approval.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const run = await startRun(auth.userId, params.id);
    return NextResponse.json({ run: { id: run.id, status: run.status, plan: run.plan, env: run.env, baseBranch: run.baseBranch } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
