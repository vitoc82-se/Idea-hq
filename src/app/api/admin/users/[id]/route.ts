import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { cleanUserPatch } from "@/lib/admin-users";

// Owner-only: change one account's settings: approval, optional features
// (Support tickets), AI build and the daily helper-AI call limit.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const checked = cleanUserPatch(await request.json().catch(() => null));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const target = await db.user.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const user = await db.user.update({
    where: { id: params.id },
    data: checked.patch,
    select: { id: true, email: true, approved: true, features: true, aiBuild: true, aiDailyLimit: true, freeAccess: true, aiCredits: true },
  });
  return NextResponse.json({ user });
}
