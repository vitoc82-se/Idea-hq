import { describe, it, expect, vi, beforeEach } from "vitest";

// The AI-call counter, the AI build check and the support rate buckets against
// a real Postgres. PGlite runs queries one at a time, so the parallel tests show
// there is no read-then-write race and that the limit logic is right; the
// row-lock guarantee under true concurrency comes from the single conditional
// UPDATE and is Postgres's own.
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { consumeAiCallDetailed, consumeAiCall, aiBuildAllowed, dailyAiLimit } from "@/lib/access";
import { rateStore } from "@/lib/support/public-store";

const DAY = new Date("2026-10-18T10:00:00Z");
const NEXT_DAY = new Date("2026-10-19T00:00:05Z");
const mk = (id: string, data: Record<string, unknown> = {}) => db.user.create({ data: { id, email: `${id}@x.se`, approved: true, ...data } });
const ask = (id: string, now = DAY) => consumeAiCallDetailed(id, `${id}@x.se`, now);

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "owner@x.se";
  delete process.env.AI_DAILY_LIMIT;
});

describe("consumeAiCall on real Postgres", () => {
  it("a brand-new account (no day recorded yet) starts at 1 and counts up to the default 20", async () => {
    await mk("new");
    const results: string[] = [];
    for (let i = 0; i < 22; i++) results.push(await ask("new"));
    expect(results.filter((r) => r === "ok")).toHaveLength(20);
    expect(results.slice(20)).toEqual(["limit", "limit"]);
    const u = await db.user.findUnique({ where: { id: "new" } });
    expect(u).toMatchObject({ aiCallsDay: "2026-10-18", aiCallsToday: 20 });
  });
  it("rolls over to a fresh allowance on the next UTC day", async () => {
    await mk("roll", { aiCallsDay: "2026-10-18", aiCallsToday: 20 });
    expect(await ask("roll")).toBe("limit");
    expect(await ask("roll", NEXT_DAY)).toBe("ok");
    expect(await db.user.findUnique({ where: { id: "roll" } })).toMatchObject({ aiCallsDay: "2026-10-19", aiCallsToday: 1 });
  });
  it("uses the person's own limit, 0 means off, empty means the site default", async () => {
    await mk("three", { aiDailyLimit: 3 });
    await mk("zero", { aiDailyLimit: 0 });
    await mk("dflt");
    process.env.AI_DAILY_LIMIT = "2";
    expect([await ask("three"), await ask("three"), await ask("three"), await ask("three")]).toEqual(["ok", "ok", "ok", "limit"]);
    expect(await ask("zero")).toBe("off");
    expect((await db.user.findUnique({ where: { id: "zero" } }))?.aiCallsToday).toBe(0);
    expect([await ask("dflt"), await ask("dflt"), await ask("dflt")]).toEqual(["ok", "ok", "limit"]);
  });
  it("AI_DAILY_LIMIT=0 in the environment still means the default, not off", () => {
    process.env.AI_DAILY_LIMIT = "0";
    expect(dailyAiLimit()).toBe(20);
  });
  it("never limits or counts the owner", async () => {
    await db.user.create({ data: { id: "owner", email: "owner@x.se", approved: true, aiDailyLimit: 0 } });
    for (let i = 0; i < 30; i++) expect(await consumeAiCallDetailed("owner", "owner@x.se", DAY)).toBe("ok");
    expect((await db.user.findUnique({ where: { id: "owner" } }))?.aiCallsToday).toBe(0);
  });
  it("an unknown account is refused", async () => {
    expect(await consumeAiCall("ghost", "ghost@x.se")).toBe(false);
  });
  it("10 calls at once with a limit of 5 let exactly 5 through (existing account)", async () => {
    await mk("par", { aiDailyLimit: 5, aiCallsDay: "2026-10-18", aiCallsToday: 0 });
    const r = await Promise.all(Array.from({ length: 10 }, () => ask("par")));
    expect(r.filter((x) => x === "ok")).toHaveLength(5);
    expect((await db.user.findUnique({ where: { id: "par" } }))?.aiCallsToday).toBe(5);
  });
  it("10 calls at once on a brand-new account (empty day) also stop at the limit", async () => {
    await mk("parnew", { aiDailyLimit: 5 });
    const r = await Promise.all(Array.from({ length: 10 }, () => ask("parnew")));
    expect(r.filter((x) => x === "ok")).toHaveLength(5);
  });
  it("one person's calls never touch another's counter", async () => {
    await mk("a", { aiDailyLimit: 1 });
    await mk("b", { aiDailyLimit: 1 });
    expect(await ask("a")).toBe("ok");
    expect(await ask("a")).toBe("limit");
    expect(await ask("b")).toBe("ok");
  });
});

describe("aiBuildAllowed on real Postgres", () => {
  it("is on by default, off when switched off, and never off for the owner", async () => {
    await mk("friend");
    await mk("off", { aiBuild: false });
    await db.user.create({ data: { id: "owner", email: "owner@x.se", approved: true, aiBuild: false } });
    expect(await aiBuildAllowed("friend")).toBe(true);
    expect(await aiBuildAllowed("off")).toBe(false);
    expect(await aiBuildAllowed("owner")).toBe(true);
    expect(await aiBuildAllowed("ghost")).toBe(false);
  });
  it("switching it back on restores access without anything else", async () => {
    await mk("flip", { aiBuild: false });
    expect(await aiBuildAllowed("flip")).toBe(false);
    await db.user.update({ where: { id: "flip" }, data: { aiBuild: true } });
    expect(await aiBuildAllowed("flip")).toBe(true);
  });
});

describe("support rate buckets on real Postgres", () => {
  it("counts hits in a window and starts over after it", async () => {
    expect([await rateStore.hit("k", 60), await rateStore.hit("k", 60), await rateStore.hit("k", 60)]).toEqual([1, 2, 3]);
    await db.$executeRaw`UPDATE "RateBucket" SET "windowStart" = now() - interval '2 minutes' WHERE "key" = 'k'`;
    expect(await rateStore.hit("k", 60)).toBe(1);
  });
  it("10 hits at once all get distinct counts", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => rateStore.hit("par", 60)));
    expect(new Set(r).size).toBe(10);
    expect(Math.max(...r)).toBe(10);
  });
  it("keys do not share counts", async () => {
    await rateStore.hit("x", 60);
    expect(await rateStore.hit("y", 60)).toBe(1);
  });
});
