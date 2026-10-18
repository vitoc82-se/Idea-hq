import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbProxy, calls, override, OWNER, FRIEND, UNAPPROVED, MUSTCHANGE } from "./helpers";

vi.mock("@/lib/db", () => ({ db: makeDbProxy() }));

import { canUse, dailyAiLimit } from "@/lib/access";

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

// consumeAiCall and the AI build check run against a real Postgres: tests/pg-counter.test.ts.
describe("dailyAiLimit", () => {
  it("defaults to 20 and ignores junk limits", () => {
    expect(dailyAiLimit()).toBe(20);
    process.env.AI_DAILY_LIMIT = "abc";
    expect(dailyAiLimit()).toBe(20);
    process.env.AI_DAILY_LIMIT = "5";
    expect(dailyAiLimit()).toBe(5);
  });
});
