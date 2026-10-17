import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbProxy, calls, override, OWNER, FRIEND, UNAPPROVED, MUSTCHANGE } from "./helpers";

vi.mock("@/lib/db", () => ({ db: makeDbProxy() }));

import { canUse, consumeAiCall, dailyAiLimit } from "@/lib/access";

beforeEach(() => {
  calls.length = 0;
  override.userFindUnique = undefined;
  process.env.OWNER_EMAIL = OWNER.email;
  delete process.env.AI_DAILY_LIMIT;
});

describe("canUse", () => {
  it("allows the owner", async () => expect(await canUse(OWNER.id, OWNER.email)).toBe(true));
  it("allows an approved friend", async () => expect(await canUse(FRIEND.id, FRIEND.email)).toBe(true));
  it("denies an unapproved account", async () => expect(await canUse(UNAPPROVED.id, UNAPPROVED.email)).toBe(false));
  it("denies an account that must change its password", async () =>
    expect(await canUse(MUSTCHANGE.id, MUSTCHANGE.email)).toBe(false));
  it("denies anonymous and unknown ids", async () => {
    expect(await canUse(null, null)).toBe(false);
    expect(await canUse("nope", "nope@x.se")).toBe(false);
  });
});

describe("consumeAiCall", () => {
  it("never limits the owner", async () => {
    expect(await consumeAiCall(OWNER.id, OWNER.email)).toBe(true);
    expect(calls.filter((c) => c.method === "update")).toHaveLength(0);
  });

  it("starts a new day at 1 and counts up", async () => {
    expect(await consumeAiCall(FRIEND.id, FRIEND.email, new Date("2026-10-17T10:00:00Z"))).toBe(true);
    const upd = calls.find((c) => c.method === "update")!;
    expect((upd.args[0] as { data: unknown }).data).toEqual({ aiCallsDay: "2026-10-17", aiCallsToday: 1 });
  });

  it("refuses once the daily limit is used up", async () => {
    process.env.AI_DAILY_LIMIT = "2";
    override.userFindUnique = () => ({ aiCallsDay: "2026-10-17", aiCallsToday: 2 });
    expect(await consumeAiCall(FRIEND.id, FRIEND.email, new Date("2026-10-17T23:59:00Z"))).toBe(false);
  });

  it("defaults to 20 and ignores junk limits", () => {
    expect(dailyAiLimit()).toBe(20);
    process.env.AI_DAILY_LIMIT = "abc";
    expect(dailyAiLimit()).toBe(20);
    process.env.AI_DAILY_LIMIT = "5";
    expect(dailyAiLimit()).toBe(5);
  });
});
