import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

// "Skip for now" / "I'm done": stop sending this user to the welcome page.
export async function POST() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.user.update({ where: { id: userId }, data: { onboardingDismissed: true } });
  return NextResponse.json({ ok: true });
}
