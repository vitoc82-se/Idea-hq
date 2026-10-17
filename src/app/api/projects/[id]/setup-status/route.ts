import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { getSetupStatus } from "@/lib/runs/setup";

// Progress of the guided setup. `?quick=1` skips GitHub calls (used for list chips).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const quick = new URL(request.url).searchParams.get("quick") === "1";
    return NextResponse.json(await getSetupStatus(auth.userId, params.id, { quick }));
  } catch (e) {
    return errorResponse(e);
  }
}
