import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { getRunProgress } from "@/lib/runs/progress";

// Where a running run is right now: its stages, which one is under way, how long it has been going.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const progress = await getRunProgress(auth.userId, params.id);
    if (!progress) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(progress, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
