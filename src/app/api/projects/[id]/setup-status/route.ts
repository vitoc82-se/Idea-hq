import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { getSetupStatus } from "@/lib/runs/setup";

// Progress of the guided setup. `?quick=1` makes no GitHub calls (cheap polling, list chips);
// the default shares a 30s cached full check; `?fresh=1` forces a new one ("Check again").
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const q = new URL(request.url).searchParams;
    return NextResponse.json(await getSetupStatus(auth.userId, params.id, { quick: q.get("quick") === "1", fresh: q.get("fresh") === "1" }));
  } catch (e) {
    return errorResponse(e);
  }
}
