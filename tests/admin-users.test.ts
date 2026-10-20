import { describe, it, expect, vi, beforeEach } from "vitest";

// The owner's admin routes against a real Postgres (so groupBy, ordering and the
// new columns behave as in production).
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
vi.mock("next-auth", () => ({ getServerSession: async () => (sess.user ? { user: sess.user } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { db, resetDb } from "./pg";
import { GET } from "@/app/api/admin/users/route";
import { PATCH } from "@/app/api/admin/users/[id]/route";
import { cleanUserPatch, AI_LIMIT_MAX } from "@/lib/admin-users";

const OWNER = { id: "owner", email: "owner@x.se" };
const FRIEND = { id: "friend", email: "friend@x.se" };
const today = new Date().toISOString().slice(0, 10);

const patch = (id: string, body: unknown) =>
  PATCH(new Request("https://ideahq.cloud/api/admin/users/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: { id } });

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = OWNER.email;
  sess.user = OWNER;
  await db.user.create({ data: { id: "owner", email: OWNER.email, name: "Niklas", approved: true, createdAt: new Date("2026-01-01") } });
  await db.user.create({ data: { id: "friend", email: FRIEND.email, name: "Ann", approved: true, password: "secret-hash", createdAt: new Date("2026-02-01"), aiCallsDay: today, aiCallsToday: 4, aiDailyLimit: 10 } });
  await db.user.create({ data: { id: "waiting", email: "new@x.se", approved: false, createdAt: new Date("2026-03-01"), aiCallsDay: "2020-01-01", aiCallsToday: 9 } });
  await db.project.create({ data: { id: "p1", userId: "friend", name: "Shop", slug: "shop", context: "" } });
  await db.idea.create({ data: { userId: "friend", projectId: "p1", title: "A" } });
  await db.idea.create({ data: { userId: "friend", projectId: "p1", title: "B" } });
  await db.run.create({ data: { userId: "friend", projectId: "p1" } });
});

describe("GET /api/admin/users", () => {
  it("is owner only", async () => {
    sess.user = null;
    expect((await GET()).status).toBe(401);
    sess.user = FRIEND;
    expect((await GET()).status).toBe(401);
  });
  it("lists everyone with settings, activity and today's usage, waiting people first", async () => {
    const d = await (await GET()).json();
    expect(d.users.map((u: { id: string }) => u.id)).toEqual(["waiting", "owner", "friend"]);
    const friend = d.users.find((u: { id: string }) => u.id === "friend");
    expect(friend).toMatchObject({ approved: true, aiBuild: true, aiDailyLimit: 10, aiCallsToday: 4, projects: 1, ideas: 2, runs: 1, owner: false, features: [] });
    expect(d.users.find((u: { id: string }) => u.id === "owner")).toMatchObject({ owner: true, projects: 0, ideas: 0, runs: 0 });
    expect(d.defaultDailyLimit).toBe(20);
    expect(d.usageDay).toBe(today);
  });
  it("counts usage only when the stored day is today (UTC)", async () => {
    const d = await (await GET()).json();
    expect(d.users.find((u: { id: string }) => u.id === "waiting").aiCallsToday).toBe(0);
  });
  it("never returns password hashes", async () => {
    expect(JSON.stringify(await (await GET()).json())).not.toMatch(/secret-hash|password/);
  });
  it("finds the owner by first account when OWNER_EMAIL is not set", async () => {
    delete process.env.OWNER_EMAIL;
    sess.user = { id: "owner", email: OWNER.email };
    const d = await (await GET()).json();
    expect(d.users.filter((u: { owner: boolean }) => u.owner).map((u: { id: string }) => u.id)).toEqual(["owner"]);
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  it("is owner only and touches nothing otherwise", async () => {
    sess.user = FRIEND;
    expect((await patch("waiting", { approved: true })).status).toBe(401);
    sess.user = null;
    expect((await patch("waiting", { approved: true })).status).toBe(401);
    expect((await db.user.findUnique({ where: { id: "waiting" } }))?.approved).toBe(false);
  });
  it("changes each setting on its own and leaves the others alone", async () => {
    expect((await patch("waiting", { approved: true })).status).toBe(200);
    expect(await db.user.findUnique({ where: { id: "waiting" } })).toMatchObject({ approved: true, aiBuild: true, aiDailyLimit: null });
    await patch("friend", { aiBuild: false });
    expect(await db.user.findUnique({ where: { id: "friend" } })).toMatchObject({ aiBuild: false, aiDailyLimit: 10, approved: true });
    await patch("friend", { aiDailyLimit: 0 });
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.aiDailyLimit).toBe(0);
    await patch("friend", { aiDailyLimit: null });
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.aiDailyLimit).toBeNull();
    await patch("friend", { features: ["tickets", "tickets"] });
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.features).toEqual(["tickets"]);
  });
  it("returns the updated settings and never a password", async () => {
    const d = await (await patch("friend", { aiBuild: false })).json();
    expect(d.user).toMatchObject({ id: "friend", aiBuild: false });
    expect(JSON.stringify(d)).not.toMatch(/password|secret-hash/);
  });
  it("404s for an unknown account", async () => {
    expect((await patch("ghost", { aiBuild: false })).status).toBe(404);
  });
  it("rejects bad values with a plain message and changes nothing", async () => {
    for (const bad of [{ aiDailyLimit: -1 }, { aiDailyLimit: 1.5 }, { aiDailyLimit: "5" }, { aiDailyLimit: AI_LIMIT_MAX + 1 }, { aiBuild: "yes" }, { approved: 1 }, { features: ["root"] }, { features: "tickets" }, { sneaky: true }, {}]) {
      const res = await patch("friend", bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(await db.user.findUnique({ where: { id: "friend" } })).toMatchObject({ aiBuild: true, aiDailyLimit: 10, approved: true });
  });
  it("accepts the limit bounds 0 and 1000", async () => {
    expect((await patch("friend", { aiDailyLimit: 0 })).status).toBe(200);
    expect((await patch("friend", { aiDailyLimit: AI_LIMIT_MAX })).status).toBe(200);
  });
});

describe("cleanUserPatch", () => {
  it("rejects non-objects", () => {
    for (const bad of [null, "x", 5, [], undefined]) expect(cleanUserPatch(bad).ok).toBe(false);
  });
  it("accepts several settings at once", () => {
    expect(cleanUserPatch({ approved: true, aiBuild: false, aiDailyLimit: 3 })).toEqual({ ok: true, patch: { approved: true, aiBuild: false, aiDailyLimit: 3 } });
  });
});

describe("switching a person's Pro off", () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(async () => {
    calls.length = 0;
    delete process.env.LEMONSQUEEZY_API_KEY;
    await db.user.update({ where: { id: "friend" }, data: { subStatus: "active", lsSubscriptionId: "123456", proRevokedAt: null } });
  });
  const afterAll_ = () => { globalThis.fetch = realFetch; delete process.env.LEMONSQUEEZY_API_KEY; };
  const mockFetch = (ok: boolean, throws = false) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (throws) throw new Error("network down");
      return new Response("{}", { status: ok ? 200 : 500 });
    }) as typeof fetch;
  };

  it("validates the new setting", () => {
    expect(cleanUserPatch({ proRevoked: true })).toEqual({ ok: true, patch: { proRevoked: true } });
    expect(cleanUserPatch({ proRevoked: "yes" })).toMatchObject({ ok: false });
  });
  it("switches Pro off right away and says the subscription still runs when no Lemon Squeezy key is set", async () => {
    mockFetch(true);
    const res = await patch("friend", { proRevoked: true });
    expect(res.status).toBe(200);
    expect((await res.json()).lsCancel).toBe("skipped");
    expect(calls).toHaveLength(0);
    const u = await db.user.findUnique({ where: { id: "friend" } });
    expect(u?.proRevokedAt).toBeInstanceOf(Date);
    const list = await (await GET()).json();
    expect(list.users.find((x: { id: string }) => x.id === "friend")).toMatchObject({ pro: false, proRevoked: true, lsSubscriptionId: "123456" });
    afterAll_();
  });
  it("also cancels the subscription at Lemon Squeezy when a key is set", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "lsq_test_key";
    mockFetch(true);
    const res = await patch("friend", { proRevoked: true });
    expect((await res.json()).lsCancel).toBe("cancelled");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.lemonsqueezy.com/v1/subscriptions/123456");
    expect(calls[0].init.method).toBe("DELETE");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer lsq_test_key");
    afterAll_();
  });
  it("still switches Pro off when Lemon Squeezy fails, and says so", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "lsq_test_key";
    mockFetch(false);
    expect((await (await patch("friend", { proRevoked: true })).json()).lsCancel).toBe("failed");
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.proRevokedAt).toBeInstanceOf(Date);
    await db.user.update({ where: { id: "friend" }, data: { proRevokedAt: null } });
    mockFetch(true, true);
    expect((await (await patch("friend", { proRevoked: true })).json()).lsCancel).toBe("failed");
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.proRevokedAt).toBeInstanceOf(Date);
    afterAll_();
  });
  it("never sends a strange subscription id to Lemon Squeezy", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "lsq_test_key";
    mockFetch(true);
    await db.user.update({ where: { id: "friend" }, data: { lsSubscriptionId: "../../orders/1" } });
    expect((await (await patch("friend", { proRevoked: true })).json()).lsCancel).toBe("skipped");
    expect(calls).toHaveLength(0);
    afterAll_();
  });
  it("restoring clears it and does not call Lemon Squeezy", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "lsq_test_key";
    mockFetch(true);
    await patch("friend", { proRevoked: true });
    calls.length = 0;
    const res = await patch("friend", { proRevoked: false });
    expect((await res.json()).lsCancel).toBeNull();
    expect(calls).toHaveLength(0);
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.proRevokedAt).toBeNull();
    afterAll_();
  });
  it("only the owner can do it", async () => {
    sess.user = FRIEND;
    const res = await patch("friend", { proRevoked: true });
    expect(res.status).toBe(401);
    expect((await db.user.findUnique({ where: { id: "friend" } }))?.proRevokedAt).toBeNull();
  });
});
