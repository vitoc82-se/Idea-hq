import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOnboarding } from "@/lib/onboarding";
import { errorResponse } from "@/lib/runs/http";

// Any signed-in user (approved or not) may read their own onboarding state.
// Cheap by default (no GitHub calls); `?full=1` also asks GitHub.
export async function GET(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getOnboarding(userId, session?.user?.email, { quick: new URL(request.url).searchParams.get("full") !== "1" }));
  } catch (e) {
    return errorResponse(e);
  }
}
