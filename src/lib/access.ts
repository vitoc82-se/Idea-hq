import { db } from "./db";
import { isOwner } from "./owner";

// Invite-only access (eng review D5). The owner is always allowed; anyone else
// needs `User.approved`. Accounts that still owe a forced password change get
// nothing until they change it.
export async function canUse(
  userId: string | null | undefined,
  email: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { approved: true, mustChangePassword: true },
  });
  if (!user || user.mustChangePassword) return false;

  if (await isOwner(userId, email)) return true;
  return user.approved;
}

const DEFAULT_DAILY_AI_CALLS = 20;

export function dailyAiLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_AI_CALLS;
}

// Counts one server-paid AI call (estimate / plan / breakdown) against the
// user's UTC-day allowance (eng review D6). The owner is exempt. Returns false
// when the allowance is used up.
export async function consumeAiCall(
  userId: string,
  email: string | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (await isOwner(userId, email)) return true;

  const today = now.toISOString().slice(0, 10);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { aiCallsDay: true, aiCallsToday: true },
  });
  if (!user) return false;

  if (user.aiCallsDay !== today) {
    await db.user.update({
      where: { id: userId },
      data: { aiCallsDay: today, aiCallsToday: 1 },
    });
    return true;
  }
  if (user.aiCallsToday >= dailyAiLimit()) return false;

  await db.user.update({
    where: { id: userId },
    data: { aiCallsToday: { increment: 1 } },
  });
  return true;
}
