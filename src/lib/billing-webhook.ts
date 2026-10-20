import crypto from "crypto";
import { db } from "./db";
import { CREDITS_PER_PACK, isPro } from "./billing";

// Lemon Squeezy signs the raw body with HMAC-SHA256 (hex) in X-Signature.
export function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const want = Buffer.from(crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.trim());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export type WebhookOutcome =
  | { handled: "subscription" | "credits" | "refund" }
  | { ignored: string };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function isDuplicate(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2002";
}

// Applies one verified Lemon Squeezy event. People are matched by the user_id we
// put into the checkout link (custom data), never by email. Safe to run twice
// with the same event: subscriptions only move forward in time, and orders are
// recorded in BillingEvent before credits move.
export async function applyBillingEvent(payload: unknown): Promise<WebhookOutcome> {
  const body = obj(payload);
  const meta = obj(body.meta);
  const name = str(meta.event_name) || "";
  const custom = obj(meta.custom_data);
  const data = obj(body.data);
  const attrs = obj(data.attributes);
  const dataId = str(data.id);
  const customUser = str(custom.user_id);
  if (!dataId) return { ignored: "no id" };

  if (name.startsWith("subscription_") && !name.startsWith("subscription_payment_")) {
    const status = str(attrs.status);
    const updatedAt = date(attrs.updated_at);
    if (!status || !updatedAt) return { ignored: "incomplete subscription" };
    let user = customUser ? await db.user.findUnique({ where: { id: customUser } }) : null;
    if (!user) user = await db.user.findFirst({ where: { lsSubscriptionId: dataId } });
    if (!user) return { ignored: "no matching user" };
    const incoming = { subStatus: status, subEndsAt: date(attrs.ends_at) };
    // A late "expired" for an old subscription must not end a newer one.
    if (user.lsSubscriptionId && user.lsSubscriptionId !== dataId && !isPro(incoming) && isPro(user)) {
      return { ignored: "older subscription" };
    }
    const portal = str(obj(attrs.urls).customer_portal);
    await db.user.updateMany({
      where: { id: user.id, OR: [{ subUpdatedAt: null }, { subUpdatedAt: { lte: updatedAt } }] },
      data: {
        subStatus: status,
        subEndsAt: incoming.subEndsAt,
        subUpdatedAt: updatedAt,
        lsSubscriptionId: dataId,
        ...(portal ? { lsPortalUrl: portal } : {}),
      },
    });
    return { handled: "subscription" };
  }

  if ((name === "order_created" || name === "order_refunded") && str(custom.kind) === "credits") {
    if (!customUser) return { ignored: "no user on order" };
    const user = await db.user.findUnique({ where: { id: customUser }, select: { id: true } });
    if (!user) return { ignored: "no matching user" };

    if (name === "order_created") {
      if (str(attrs.status) !== "paid") return { ignored: "order not paid" };
      try {
        await db.$transaction([
          db.billingEvent.create({ data: { id: `order:${dataId}`, userId: user.id } }),
          db.user.update({ where: { id: user.id }, data: { aiCredits: { increment: CREDITS_PER_PACK } } }),
        ]);
      } catch (e) {
        if (isDuplicate(e)) return { ignored: "already applied" };
        throw e;
      }
      return { handled: "credits" };
    }

    try {
      await db.$transaction([
        db.billingEvent.create({ data: { id: `refund:${dataId}`, userId: user.id } }),
        db.$executeRaw`UPDATE "User" SET "aiCredits" = GREATEST("aiCredits" - ${CREDITS_PER_PACK}, 0) WHERE "id" = ${user.id}`,
      ]);
    } catch (e) {
      if (isDuplicate(e)) return { ignored: "already applied" };
      throw e;
    }
    return { handled: "refund" };
  }

  return { ignored: name || "unknown event" };
}
