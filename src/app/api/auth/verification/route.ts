import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isVerified, sendVerificationEmail } from "@/lib/email-verification";
import { db } from "@/lib/db";
import { resendBlocked } from "@/lib/auth-limits";

export const dynamic = "force-dynamic";

// Any signed-in person (approved or not) may check whether their address is confirmed, and ask for the email again.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json({ verified: await isVerified(userId) });
}

export async function POST() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (await isVerified(userId)) return NextResponse.json({ ok: true, already: true });
  if (await resendBlocked(userId)) {
    return NextResponse.json({ error: "You have asked for this a few times already. Check your inbox and spam folder, or try again in an hour." }, { status: 429 });
  }
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const sent = await sendVerificationEmail(user).catch(() => false);
  return NextResponse.json(sent ? { ok: true } : { error: "The email could not be sent just now. Try again in a few minutes." }, { status: sent ? 200 : 502 });
}
