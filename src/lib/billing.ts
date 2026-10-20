import { db } from "./db";
import { isOwner } from "./owner";

// Payments (Lemon Squeezy). Nothing here is enforced until PAYWALL_ENABLED=1, so
// shipping this changes nothing for anyone until the owner flips that switch.
//
//   Pro            99 kr/month   AI build without a run limit, 500 helper AI calls a day
//   Runs pack      one-off       CREDITS_PER_PACK approved AI runs
//   Free access    set per person in Admin (friends and family skip the paywall)
//   Owner          always exempt

export const CREDITS_PER_PACK = 50;
export const PRO_HELPER_LIMIT = 500; // fair-use cap on helper AI calls per day for Pro
export const PRO_PRICE_LABEL = "99 kr / month";
export const NEEDS_PLAN_MESSAGE = "AI build needs Pro or a runs pack. Open Billing to upgrade.";

export function paywallOn(): boolean {
  return process.env.PAYWALL_ENABLED === "1";
}

type SubFields = { subStatus: string | null; subEndsAt: Date | null; proRevokedAt?: Date | null };

// Lemon Squeezy statuses: on_trial, active, paused, past_due, unpaid, cancelled,
// expired. past_due still counts (Lemon Squeezy retries the card for a while).
// cancelled keeps access until the period the person already paid for ends.
export function isPro(u: SubFields, now: Date = new Date()): boolean {
  if (u.proRevokedAt) return false; // the owner switched Pro off for this person
  switch (u.subStatus) {
    case "active":
    case "on_trial":
    case "past_due":
      return true;
    case "cancelled":
      return !!u.subEndsAt && u.subEndsAt.getTime() > now.getTime();
    default:
      return false;
  }
}

export type BuildAccess =
  | { ok: true; via: "owner" | "open" | "free" | "pro" | "credits" }
  | { ok: false; reason: "off" | "needs_plan" };

const SELECT = { email: true, aiBuild: true, freeAccess: true, aiCredits: true, subStatus: true, subEndsAt: true, proRevokedAt: true } as const;

// May this person START AI build work? The admin switch beats everything; with
// the paywall on they then need Pro, a credit, or free access.
export async function buildAccess(userId: string, now: Date = new Date()): Promise<BuildAccess> {
  const u = await db.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!u) return { ok: false, reason: "off" };
  if (await isOwner(userId, u.email)) return { ok: true, via: "owner" };
  if (u.aiBuild === false) return { ok: false, reason: "off" };
  if (!paywallOn()) return { ok: true, via: "open" };
  if (u.freeAccess) return { ok: true, via: "free" };
  if (isPro(u, now)) return { ok: true, via: "pro" };
  if (u.aiCredits > 0) return { ok: true, via: "credits" };
  return { ok: false, reason: "needs_plan" };
}

export class BillingBlock extends Error {
  constructor(public reason: "off" | "needs_plan") {
    super(reason);
  }
}

type Tx = Pick<typeof db, "user" | "run">;

// Called inside the transaction that approves (or starts) a run. Pro, free
// access, the owner and an open site cost nothing; otherwise one credit is used,
// atomically, so two parallel approvals cannot both spend the last one.
// Returns true when a credit was spent (the run remembers it for refunds).
export async function chargeBuild(tx: Tx, userId: string, now: Date = new Date()): Promise<boolean> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!u) return false;
  if (await isOwner(userId, u.email)) return false;
  if (u.aiBuild === false) throw new BillingBlock("off");
  if (!paywallOn() || u.freeAccess || isPro(u, now)) return false;
  const res = await tx.user.updateMany({ where: { id: userId, aiCredits: { gt: 0 } }, data: { aiCredits: { decrement: 1 } } });
  if (res.count !== 1) throw new BillingBlock("needs_plan");
  return true;
}

// A run that failed gives its credit back, once.
export async function refundBuildCredit(runId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const flag = await tx.run.updateMany({ where: { id: runId, creditCharged: true }, data: { creditCharged: false } });
    if (flag.count !== 1) return false;
    const run = await tx.run.findUnique({ where: { id: runId }, select: { userId: true } });
    if (!run) return false;
    await tx.user.update({ where: { id: run.userId }, data: { aiCredits: { increment: 1 } } });
    return true;
  });
}

// ---- checkout links ---------------------------------------------------------

export type CheckoutKind = "pro" | "credits";

function httpsEnvUrl(name: string): URL | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

// The Lemon Squeezy checkout link, tagged with the person so the payment lands
// on the right account. "kind" tells the webhook what was bought.
export function checkoutUrl(kind: CheckoutKind, user: { id: string; email: string | null }): string | null {
  const u = httpsEnvUrl(kind === "pro" ? "LEMONSQUEEZY_PRO_URL" : "LEMONSQUEEZY_CREDITS_URL");
  if (!u) return null;
  u.searchParams.set("checkout[custom][user_id]", user.id);
  u.searchParams.set("checkout[custom][kind]", kind);
  if (user.email) u.searchParams.set("checkout[email]", user.email);
  return u.toString();
}

export async function billingStatus(userId: string, now: Date = new Date()) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, freeAccess: true, aiCredits: true, subStatus: true, subEndsAt: true, proRevokedAt: true, lsPortalUrl: true },
  });
  if (!u) return null;
  const owner = await isOwner(userId, u.email);
  return {
    paywall: paywallOn(),
    owner,
    freeAccess: u.freeAccess,
    pro: isPro(u, now),
    proRevoked: !!u.proRevokedAt,
    subStatus: u.subStatus,
    subEndsAt: u.subEndsAt ? u.subEndsAt.toISOString() : null,
    credits: u.aiCredits,
    packSize: CREDITS_PER_PACK,
    proPrice: PRO_PRICE_LABEL,
    proUrl: u.proRevokedAt ? null : checkoutUrl("pro", u),
    creditsUrl: checkoutUrl("credits", u),
    portalUrl: u.lsPortalUrl && /^https:\/\//.test(u.lsPortalUrl) ? u.lsPortalUrl : null,
  };
}
