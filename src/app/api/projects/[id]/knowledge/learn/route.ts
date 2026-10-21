import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { startLearnRun } from "@/lib/runs/engine";

// "Learn this project": the AI explores the whole repo inside the owner's own
// GitHub Actions (their key), writes what it found, and opens a PR with it.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const run = await startLearnRun(auth.userId, params.id);
    return NextResponse.json({ runId: run.id, status: run.status }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
