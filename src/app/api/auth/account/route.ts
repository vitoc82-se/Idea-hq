import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accountSummary, deleteAccount } from "@/lib/account-data";
import { deleteAccountBlocked } from "@/lib/auth-limits";

export const dynamic = "force-dynamic";

// Any signed-in person (approved or not) may see what deleting their account involves, and delete it.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const summary = await accountSummary(userId, session?.user?.email);
  if (!summary) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json(summary);
}

export async function DELETE(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  // Typing a password here is a way to guess one, so it is limited like sign-in.
  if (await deleteAccountBlocked(userId)) return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  const body = await request.json().catch(() => null);
  const result = await deleteAccount(userId, session?.user?.email, { confirm: body?.confirm, password: body?.password });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
