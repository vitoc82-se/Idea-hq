import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Payments against a real Postgres: the webhook (signature, subscriptions that
// arrive out of order, a runs pack that must be granted exactly once), the
// access rules, and the credit counter under parallel approvals.
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { applyBillingEvent, verifySignature } from "@/lib/billing-webhook";
import { buildAccess, chargeBuild, refundBuildCredit, checkoutUrl, billingStatus, isPro, BillingBlock, CREDITS_PER_PACK } from "@/lib/billing";
import { consumeAiCallDetailed } from "@/lib/access";
import { cleanUserPatch } from "@/lib/admin-users";
import { POST } from "@/app/api/billing/lemonsqueezy/webhook/route";

const mk = (id: string, data: Record<string, unknown> = {}) => db.user.create({ data: { id, email: `${id}@x.se`, approved: true, ...data } });
const credits = async (id: string) => (await db.user.findUnique({ where: { id } }))!.aiCredits;

const sub = (userId: string | null, status: string, updatedAt: string, o: { id?: string; endsAt?: string | null; event?: string } = {}) => ({
  meta: { event_name: o.event ?? "subscription_updated", custom_data: userId ? { user_id: userId, kind: "pro" } : {} },
  data: { id: o.id ?? "sub1", attributes: { status, updated_at: updatedAt, ends_at: o.endsAt ?? null, urls: { customer_portal: "https://store.lemonsqueezy.com/billing?x=1" } } },
});
const order = (userId: string | null, id: string, o: { event?: string; kind?: string; status?: string } = {}) => ({
  meta: { event_name: o.event ?? "order_created", custom_data: userId ? { user_id: userId, kind: o.kind ?? "credits" } : {} },
  data: { id, attributes: { status: o.status ?? "paid" } },
});

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "owner@x.se";
  process.env.PAYWALL_ENABLED = "1";
});
afterEach(() => {
  delete process.env.PAYWALL_ENABLED;
  delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  delete process.env.LEMONSQUEEZY_PRO_URL;
  delete process.env.LEMONSQUEEZY_CREDITS_URL;
});

describe("webhook signature", () => {
  const sig = (raw: string, secret: string) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
  it("accepts the right signature and rejects everything else", () => {
    expect(verifySignature("{}", sig("{}", "s3cret"), "s3cret")).toBe(true);
    expect(verifySignature("{}", sig("{}", "other"), "s3cret")).toBe(false);
    expect(verifySignature("{ }", sig("{}", "s3cret"), "s3cret")).toBe(false);
    expect(verifySignature("{}", null, "s3cret")).toBe(false);
    expect(verifySignature("{}", "short", "s3cret")).toBe(false);
    expect(verifySignature("{}", sig("{}", ""), "")).toBe(false);
  });
  it("the route answers 503 without a secret, 401 for a bad signature, 200 and applies a good one", async () => {
    await mk("u1");
    const body = JSON.stringify(order("u1", "o1"));
    const call = (signature: string | null) => POST(new Request("http://x/api/billing/lemonsqueezy/webhook", { method: "POST", body, headers: signature ? { "x-signature": signature } : {} }));
    expect((await call("whatever")).status).toBe(503);
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "s3cret";
    expect((await call(null)).status).toBe(401);
    expect((await call("00".repeat(32))).status).toBe(401);
    expect(await credits("u1")).toBe(0);
    const ok = await call(sig(body, "s3cret"));
    expect(ok.status).toBe(200);
    expect(await credits("u1")).toBe(CREDITS_PER_PACK);
    const bad = await POST(new Request("http://x/", { method: "POST", body: "not json", headers: { "x-signature": sig("not json", "s3cret") } }));
    expect(bad.status).toBe(400);
  });
});

describe("subscriptions", () => {
  it("a new subscription makes the person Pro and stores the manage link", async () => {
    await mk("u1");
    expect(await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z", { event: "subscription_created" }))).toEqual({ handled: "subscription" });
    const u = (await db.user.findUnique({ where: { id: "u1" } }))!;
    expect(u).toMatchObject({ subStatus: "active", lsSubscriptionId: "sub1", lsPortalUrl: "https://store.lemonsqueezy.com/billing?x=1" });
    expect(isPro(u)).toBe(true);
  });
  it("cancelled keeps Pro until the paid period ends; expired ends it", async () => {
    await mk("u1");
    await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z"));
    await applyBillingEvent(sub("u1", "cancelled", "2026-10-21T10:00:00Z", { endsAt: "2026-11-20T10:00:00Z", event: "subscription_cancelled" }));
    const u = (await db.user.findUnique({ where: { id: "u1" } }))!;
    expect(isPro(u, new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(isPro(u, new Date("2026-11-21T00:00:00Z"))).toBe(false);
    await applyBillingEvent(sub("u1", "expired", "2026-11-20T10:00:05Z", { event: "subscription_expired" }));
    expect(isPro((await db.user.findUnique({ where: { id: "u1" } }))!)).toBe(false);
  });
  it("an old event that arrives late cannot undo a newer one, and replays are harmless", async () => {
    await mk("u1");
    await applyBillingEvent(sub("u1", "cancelled", "2026-10-22T10:00:00Z", { endsAt: "2026-12-01T00:00:00Z" }));
    await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z")); // older, late
    expect((await db.user.findUnique({ where: { id: "u1" } }))!.subStatus).toBe("cancelled");
    await applyBillingEvent(sub("u1", "cancelled", "2026-10-22T10:00:00Z", { endsAt: "2026-12-01T00:00:00Z" })); // replay
    expect((await db.user.findUnique({ where: { id: "u1" } }))!.subStatus).toBe("cancelled");
  });
  it("later events find the person by subscription id when they carry no user id", async () => {
    await mk("u1");
    await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z"));
    await applyBillingEvent(sub(null, "expired", "2026-11-20T10:00:00Z"));
    expect((await db.user.findUnique({ where: { id: "u1" } }))!.subStatus).toBe("expired");
  });
  it("an old subscription expiring does not end the newer one", async () => {
    await mk("u1");
    await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z", { id: "subOld" }));
    await applyBillingEvent(sub("u1", "active", "2026-10-25T10:00:00Z", { id: "subNew" }));
    await applyBillingEvent(sub("u1", "expired", "2026-10-26T10:00:00Z", { id: "subOld" }));
    expect(await db.user.findUnique({ where: { id: "u1" } })).toMatchObject({ subStatus: "active", lsSubscriptionId: "subNew" });
  });
  it("ignores events for nobody we know, payment-only events and junk", async () => {
    expect(await applyBillingEvent(sub("ghost", "active", "2026-10-20T10:00:00Z"))).toEqual({ ignored: "no matching user" });
    await mk("u1");
    expect(await applyBillingEvent(sub("u1", "active", "2026-10-20T10:00:00Z", { event: "subscription_payment_success" }))).toEqual({ ignored: "subscription_payment_success" });
    expect(await applyBillingEvent(null)).toEqual({ ignored: "no id" });
    expect(await applyBillingEvent({ meta: { event_name: "subscription_updated" }, data: { id: "s", attributes: {} } })).toEqual({ ignored: "incomplete subscription" });
    expect((await db.user.findUnique({ where: { id: "u1" } }))!.subStatus).toBeNull();
  });
});

describe("runs pack", () => {
  it("grants the credits once, however many times Lemon Squeezy retries", async () => {
    await mk("u1");
    expect(await applyBillingEvent(order("u1", "o1"))).toEqual({ handled: "credits" });
    expect(await applyBillingEvent(order("u1", "o1"))).toEqual({ ignored: "already applied" });
    expect(await applyBillingEvent(order("u1", "o1"))).toEqual({ ignored: "already applied" });
    expect(await credits("u1")).toBe(CREDITS_PER_PACK);
    await applyBillingEvent(order("u1", "o2"));
    expect(await credits("u1")).toBe(CREDITS_PER_PACK * 2);
  });
  it("only paid credit orders count: other products, unpaid, no user, unknown user", async () => {
    await mk("u1");
    expect(await applyBillingEvent(order("u1", "o1", { kind: "pro" }))).toMatchObject({ ignored: "order_created" });
    expect(await applyBillingEvent(order("u1", "o2", { status: "pending" }))).toEqual({ ignored: "order not paid" });
    expect(await applyBillingEvent(order(null, "o3", { kind: "credits" }))).toMatchObject({ ignored: expect.any(String) });
    expect(await applyBillingEvent(order("ghost", "o4"))).toEqual({ ignored: "no matching user" });
    expect(await credits("u1")).toBe(0);
    // a pending order that later becomes paid is still granted once
    await applyBillingEvent(order("u1", "o2"));
    expect(await credits("u1")).toBe(CREDITS_PER_PACK);
  });
  it("a refund takes the pack back once and never goes below zero", async () => {
    await mk("u1", { aiCredits: 20 });
    expect(await applyBillingEvent(order("u1", "o1", { event: "order_refunded" }))).toEqual({ handled: "refund" });
    expect(await credits("u1")).toBe(0);
    expect(await applyBillingEvent(order("u1", "o1", { event: "order_refunded" }))).toEqual({ ignored: "already applied" });
    await db.user.update({ where: { id: "u1" }, data: { aiCredits: 80 } });
    await applyBillingEvent(order("u1", "o9", { event: "order_refunded" }));
    expect(await credits("u1")).toBe(30);
  });
});

describe("who may start AI build", () => {
  it("is open to all while the paywall is off, except people the owner switched off", async () => {
    delete process.env.PAYWALL_ENABLED;
    await mk("u1");
    await mk("u2", { aiBuild: false });
    expect(await buildAccess("u1")).toEqual({ ok: true, via: "open" });
    expect(await buildAccess("u2")).toEqual({ ok: false, reason: "off" });
  });
  it("with the paywall on: owner, free access, Pro and credits get in; others are asked to pay", async () => {
    await db.user.create({ data: { id: "boss", email: "owner@x.se", approved: true } });
    await mk("free", { freeAccess: true });
    await mk("pro", { subStatus: "active" });
    await mk("pack", { aiCredits: 3 });
    await mk("plain");
    await mk("off", { aiBuild: false, subStatus: "active" });
    expect(await buildAccess("boss")).toMatchObject({ ok: true, via: "owner" });
    expect(await buildAccess("free")).toMatchObject({ ok: true, via: "free" });
    expect(await buildAccess("pro")).toMatchObject({ ok: true, via: "pro" });
    expect(await buildAccess("pack")).toMatchObject({ ok: true, via: "credits" });
    expect(await buildAccess("plain")).toEqual({ ok: false, reason: "needs_plan" });
    expect(await buildAccess("off")).toEqual({ ok: false, reason: "off" });
  });
  it("two approvals at once with one credit left: exactly one wins", async () => {
    await mk("u1", { aiCredits: 1 });
    const results = await Promise.allSettled([
      db.$transaction((tx) => chargeBuild(tx as unknown as typeof db, "u1")),
      db.$transaction((tx) => chargeBuild(tx as unknown as typeof db, "u1")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BillingBlock);
    expect(await credits("u1")).toBe(0);
  });
  it("Pro, free access and the owner are never charged", async () => {
    await mk("pro", { subStatus: "active", aiCredits: 5 });
    await mk("free", { freeAccess: true, aiCredits: 5 });
    expect(await db.$transaction((tx) => chargeBuild(tx as unknown as typeof db, "pro"))).toBe(false);
    expect(await db.$transaction((tx) => chargeBuild(tx as unknown as typeof db, "free"))).toBe(false);
    expect(await credits("pro")).toBe(5);
  });
  it("a refund returns the credit exactly once", async () => {
    await mk("u1", { aiCredits: 0 });
    const proj = await db.project.create({ data: { id: "p", userId: "u1", name: "P", slug: "p", context: "" } });
    await db.run.create({ data: { id: "r1", userId: "u1", projectId: proj.id, creditCharged: true } });
    expect(await refundBuildCredit("r1")).toBe(true);
    expect(await refundBuildCredit("r1")).toBe(false);
    expect(await credits("u1")).toBe(1);
    await db.run.create({ data: { id: "r2", userId: "u1", projectId: proj.id } });
    expect(await refundBuildCredit("r2")).toBe(false);
    expect(await credits("u1")).toBe(1);
  });
});

describe("Pro and the helper AI limit", () => {
  const DAY = new Date("2026-10-20T10:00:00Z");
  it("Pro lifts the default 20 a day to 500; an explicit limit from Admin still wins", async () => {
    await mk("pro", { subStatus: "active", aiCallsDay: "2026-10-20", aiCallsToday: 25 });
    await mk("capped", { subStatus: "active", aiDailyLimit: 3, aiCallsDay: "2026-10-20", aiCallsToday: 3 });
    await mk("free", { aiCallsDay: "2026-10-20", aiCallsToday: 25 });
    expect(await consumeAiCallDetailed("pro", "pro@x.se", DAY)).toBe("ok");
    expect(await consumeAiCallDetailed("capped", "capped@x.se", DAY)).toBe("limit");
    expect(await consumeAiCallDetailed("free", "free@x.se", DAY)).toBe("limit");
  });
});

describe("links and status", () => {
  it("tags the checkout link with the person and what is bought; refuses a non-https link", () => {
    process.env.LEMONSQUEEZY_PRO_URL = "https://shop.lemonsqueezy.com/buy/abc?embed=0";
    process.env.LEMONSQUEEZY_CREDITS_URL = "http://insecure.example/buy";
    const url = new URL(checkoutUrl("pro", { id: "u1", email: "a@b.se" })!);
    expect(url.searchParams.get("checkout[custom][user_id]")).toBe("u1");
    expect(url.searchParams.get("checkout[custom][kind]")).toBe("pro");
    expect(url.searchParams.get("checkout[email]")).toBe("a@b.se");
    expect(url.searchParams.get("embed")).toBe("0");
    expect(checkoutUrl("credits", { id: "u1", email: null })).toBeNull();
  });
  it("reports plan, credits and links; the manage link must be https", async () => {
    process.env.LEMONSQUEEZY_PRO_URL = "https://shop.lemonsqueezy.com/buy/abc";
    await mk("u1", { aiCredits: 7, subStatus: "active", lsPortalUrl: "javascript:alert(1)" });
    const s = (await billingStatus("u1"))!;
    expect(s).toMatchObject({ paywall: true, pro: true, credits: 7, portalUrl: null, creditsUrl: null });
    expect(s.proUrl).toContain("checkout%5Bcustom%5D%5Buser_id%5D=u1");
    expect(await billingStatus("nobody")).toBeNull();
  });
});

describe("admin patch", () => {
  it("accepts free access and credits, rejects nonsense", () => {
    expect(cleanUserPatch({ freeAccess: true })).toEqual({ ok: true, patch: { freeAccess: true } });
    expect(cleanUserPatch({ aiCredits: 50 })).toEqual({ ok: true, patch: { aiCredits: 50 } });
    expect(cleanUserPatch({ aiCredits: -1 })).toMatchObject({ ok: false });
    expect(cleanUserPatch({ aiCredits: 1.5 })).toMatchObject({ ok: false });
    expect(cleanUserPatch({ aiCredits: "5" })).toMatchObject({ ok: false });
    expect(cleanUserPatch({ freeAccess: "yes" })).toMatchObject({ ok: false });
  });
});
