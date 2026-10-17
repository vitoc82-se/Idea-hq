import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { startRun, reconcileRun } from "@/lib/runs/engine";

const PUBLIC = {
  id: true, kind: true, status: true, env: true, baseBranch: true, branch: true, prNumber: true,
  checksState: true, costUsd: true, turns: true, error: true, createdAt: true, finishedAt: true, parentRunId: true,
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const idea = await db.idea.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true } });
    if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
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
    return NextResponse.json({ runs });
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
