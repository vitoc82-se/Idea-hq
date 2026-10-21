import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { CAPS, tooLong } from "@/lib/caps";
import { approveRun, reviseRun, mergeRun, revertRun, cancelRun } from "@/lib/runs/engine";

// POST /api/runs/:id/{approve|revise|merge|revert|cancel}
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string; action: string }> }
) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    switch (params.action) {
      case "approve": {
        const body = await request.json().catch(() => ({}));
        await approveRun(auth.userId, params.id, undefined, { model: body.model, effort: body.effort, maxTurns: body.maxTurns });
        return NextResponse.json({ ok: true });
      }
      case "revise": {
        const body = await request.json().catch(() => ({}));
        const tooBig = tooLong("The instruction", body.instruction, CAPS.instruction);
        if (tooBig) return NextResponse.json({ error: tooBig }, { status: 400 });
        await reviseRun(auth.userId, params.id, String(body.instruction || ""));
        return NextResponse.json({ ok: true });
      }
      case "merge":
        return NextResponse.json(await mergeRun(auth.userId, params.id));
      case "revert": {
        const r = await revertRun(auth.userId, params.id);
        return NextResponse.json({ ok: true, runId: r.id });
      }
      case "cancel":
        await cancelRun(auth.userId, params.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
