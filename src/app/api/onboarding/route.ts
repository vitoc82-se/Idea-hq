import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOnboarding } from "@/lib/onboarding";
import { errorResponse } from "@/lib/runs/http";

// Any signed-in user (approved or not) may read their own onboarding state.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getOnboarding(userId, session?.user?.email));
  } catch (e) {
    return errorResponse(e);
  }
}
