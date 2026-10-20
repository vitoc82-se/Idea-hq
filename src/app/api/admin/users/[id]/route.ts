import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner, ownerUserId } from "@/lib/owner";
import { cleanUserPatch } from "@/lib/admin-users";
import { cancelLemonSubscription, type CancelResult } from "@/lib/billing-lemon";
import { isVerified } from "@/lib/email-verification";

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
    select: { id: true, lsSubscriptionId: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const { proRevoked, allowUnverified, ...rest } = checked.patch;
  // Approving someone whose email address is not confirmed is the way a stranger gets in by registering
  // a friend's address. It needs an explicit "approve anyway".
  if (rest.approved === true && !allowUnverified && !(await isVerified(target.id))) {
    return NextResponse.json({ error: "This person has not confirmed their email yet, so the address may not be theirs. Ask them to open the link we emailed, or approve anyway.", needsConfirmation: "unverified" }, { status: 409 });
  }
  // Switching Pro off also asks Lemon Squeezy to stop the subscription, so the person is not charged again.
  let lsCancel: CancelResult | null = null;
  if (proRevoked === true) lsCancel = await cancelLemonSubscription(target.lsSubscriptionId);
  const user = await db.user.update({
    where: { id: params.id },
    data: { ...rest, ...(proRevoked === undefined ? {} : { proRevokedAt: proRevoked ? new Date() : null }) },
    select: { id: true, email: true, approved: true, features: true, aiBuild: true, aiDailyLimit: true, freeAccess: true, aiCredits: true, proRevokedAt: true },
  });
  return NextResponse.json({ user, lsCancel });
}

// Owner: remove an account (for example a lookalike of an existing address). The owner's own
// account can never be removed. An account that already has projects or ideas is only removed
// when the request says `force`, so a real person's work is not lost by a stray click.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  if (params.id === userId || params.id === (await ownerUserId())) {
    return NextResponse.json({ error: "The owner account cannot be removed." }, { status: 400 });
  }
  const target = await db.user.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const [projects, ideas] = await Promise.all([db.project.count({ where: { userId: params.id } }), db.idea.count({ where: { userId: params.id } })]);
  if ((projects > 0 || ideas > 0) && body?.force !== true) {
    return NextResponse.json({ error: `This account has ${projects} project${projects === 1 ? "" : "s"} and ${ideas} idea${ideas === 1 ? "" : "s"}. Removing it deletes them for good.`, projects, ideas }, { status: 409 });
  }
  await db.user.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
