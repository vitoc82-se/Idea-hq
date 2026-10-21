import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { revokeAllSessions } from "@/lib/sessions";

// Signed-in person: sign out on every device, this one included (their own cookie stops working too).
export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  await revokeAllSessions(session.user.id);
  return NextResponse.json({ ok: true });
}
