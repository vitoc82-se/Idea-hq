import { db } from "./db";
import { isOwner } from "./owner";
import { PRO_HELPER_LIMIT, isPro } from "./billing";

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

// The site-wide default. Note AI_DAILY_LIMIT=0 means "use the default": switching
// a person's helper calls off is the per-person column (aiDailyLimit = 0).
export function dailyAiLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_AI_CALLS;
}

export type AiCallResult = "ok" | "limit" | "off";

// Counts one server-paid AI call (estimate / plan / breakdown / drafts) against
// the person's UTC-day allowance. The owner is exempt. Exact under parallel
// requests: the day reset and the increment are each one conditional UPDATE, so
// two calls at once cannot both take the last slot. The reset matches a NULL day
// too (a new account has none); Prisma's `not` alone would skip NULL rows.
export async function consumeAiCallDetailed(
  userId: string,
  email: string | null | undefined,
  now: Date = new Date()
): Promise<AiCallResult> {
  if (await isOwner(userId, email)) return "ok";

  const user = await db.user.findUnique({ where: { id: userId }, select: { aiDailyLimit: true, subStatus: true, subEndsAt: true, proRevokedAt: true } });
  if (!user) return "limit";
  // Pro lifts the default (not an explicit per-person limit set in Admin).
  const limit = user.aiDailyLimit ?? (isPro(user, now) ? PRO_HELPER_LIMIT : dailyAiLimit());
  if (limit <= 0) return "off";

  const today = now.toISOString().slice(0, 10);
  await db.user.updateMany({
    where: { id: userId, OR: [{ aiCallsDay: null }, { aiCallsDay: { not: today } }] },
    data: { aiCallsDay: today, aiCallsToday: 0 },
  });
  const res = await db.user.updateMany({
    where: { id: userId, aiCallsDay: today, aiCallsToday: { lt: limit } },
    data: { aiCallsToday: { increment: 1 } },
  });
  return res.count === 1 ? "ok" : "limit";
}

export async function consumeAiCall(
  userId: string,
  email: string | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  return (await consumeAiCallDetailed(userId, email, now)) === "ok";
}

export const AI_OFF_MESSAGE = "AI helpers are switched off for your account. Ask the owner.";
export const AI_LIMIT_MESSAGE = "Daily AI limit reached. Try again tomorrow.";

// AI build: starting AI runs in the person's own GitHub. The owner is exempt
// (looked up by account, because the run engine has no session email).
export async function aiBuildAllowed(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { aiBuild: true, email: true } });
  if (!user) return false;
  if (await isOwner(userId, user.email)) return true;
  return user.aiBuild !== false;
}
