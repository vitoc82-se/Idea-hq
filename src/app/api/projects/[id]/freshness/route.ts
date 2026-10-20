import { NextResponse } from "next/server";
import { requireUser } from "@/lib/runs/http";
import { refreshFreshness, isStale, workflowUpdateAvailable } from "@/lib/freshness";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// How current the AI's knowledge of this project and its installed workflow are. Cached for an
// hour per project; ?force=1 checks again now.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const force = new URL(request.url).searchParams.get("force") === "1";
  const f = await refreshFreshness(auth.userId, params.id, { force });
  if (!f) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { aiProvider: true } });
  return NextResponse.json({ ...f, stale: isStale(f.knowledgeBehind), workflowUpdate: workflowUpdateAvailable(f.workflowVersionSeen, p?.aiProvider) });
}
