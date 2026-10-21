import { describe, it, expect, vi, beforeEach } from "vitest";

// The "add my key to my repos" limit used to be a Map in server memory: every cold start and every extra server
// instance started again from zero. It now counts in the shared database table, like the sign-in limits.
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
process.env.OPENAI_PROVIDER_ENABLED = "1";

import { db, resetDb } from "./pg";
import { relayProviderKey } from "@/lib/provider-keys";

const KEY = "sk-test-SECRET-KEY-1234567890abcdef";
const attempt = (user = "u1") => relayProviderKey(user, "p1", { provider: "openai", key: KEY }, {});

beforeEach(async () => {
  await resetDb();
  await db.user.create({ data: { id: "u1", email: "a@x.se", approved: true } });
  await db.user.create({ data: { id: "u2", email: "b@x.se", approved: true } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } }); // no repo: the attempt stops before any GitHub call
});

describe("key relay limit", () => {
  it("is counted in the database, 12 an hour per person, and the 13th is refused", async () => {
    for (let i = 0; i < 12; i++) await expect(attempt(), `attempt ${i + 1}`).rejects.toMatchObject({ status: 409 });
    await expect(attempt()).rejects.toMatchObject({ status: 429 });
    const rows = await db.rateBucket.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(13);
    expect(rows[0].key).toMatch(/^relay:user:[0-9a-f]{32}$/); // hashed: the table never holds who it was
    expect(rows[0].key).not.toContain("u1");
  });
  it("survives a restart: nothing is kept in memory", async () => {
    for (let i = 0; i < 12; i++) await attempt().catch(() => undefined);
    vi.resetModules(); // a fresh server instance
    const fresh = await import("@/lib/provider-keys");
    await expect(fresh.relayProviderKey("u1", "p1", { provider: "openai", key: KEY }, {})).rejects.toMatchObject({ status: 429 });
  });
  it("is per person", async () => {
    for (let i = 0; i < 13; i++) await attempt().catch(() => undefined);
    await expect(attempt("u2")).rejects.toMatchObject({ status: 404 }); // not refused for rate: u2 simply has no such project
  });
});
