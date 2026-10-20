import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// The sign-up hole: anyone could register "OWNER@x.se" (or " owner@x.se") as a separate account,
// and the owner check, which compared the address case-insensitively, treated that account as the owner.
// These tests pin the fix: one standard form for emails, and an owner that is a specific account.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { POST as register } from "@/app/api/auth/register/route";
import { isOwner, ownerUserId } from "@/lib/owner";
import { canUse } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { GET as listUsers } from "@/app/api/admin/users/route";
import { DELETE as removeUser } from "@/app/api/admin/users/[id]/route";

const OWNER = "skanova@gmail.com";
const signUp = (body: unknown) => register(new Request("https://x/api/auth/register", { method: "POST", body: JSON.stringify(body) }));
const authorize = (email: unknown, password: unknown) =>
  (authOptions.providers.find((p) => p.id === "credentials") as unknown as { options: { authorize: (c: Record<string, unknown>) => Promise<{ id: string } | null> } }).options.authorize({ email, password });

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = OWNER;
  sess.user = null;
  await db.user.create({ data: { id: "owner", email: OWNER, approved: true, password: await bcrypt.hash("owner-password", 4), createdAt: new Date("2026-01-01") } });
});

describe("registration", () => {
  it("stores the address in one standard form and never makes a second account for the same person", async () => {
    const ok = await signUp({ name: "Ann", email: "  Ann@Example.SE ", password: "password123" });
    expect(ok.status).toBe(201);
    const u = await db.user.findFirst({ where: { id: (await ok.json()).userId } });
    expect(u?.email).toBe("ann@example.se");
    for (const again of ["ann@example.se", "ANN@EXAMPLE.SE", " ann@example.se ", "Ann@Example.se"]) {
      const res = await signUp({ email: again, password: "password123" });
      expect(res.status, again).toBe(409);
    }
    expect(await db.user.count()).toBe(2);
  });
  it("refuses the owner's address in any letters or padding (the hole that was live)", async () => {
    for (const variant of ["SKANOVA@gmail.com", "Skanova@Gmail.com", " skanova@gmail.com", "skanova@gmail.com ", "skanova@gmail.com\n"]) {
      const res = await signUp({ name: "x", email: variant, password: "password123" });
      expect(res.status, JSON.stringify(variant)).toBe(409);
    }
    expect(await db.user.count()).toBe(1);
  });
  it("refuses a duplicate even when the earlier account was saved with capitals (older accounts)", async () => {
    await db.user.create({ data: { id: "legacy", email: "Legacy@Example.se", approved: true } });
    expect((await signUp({ email: "legacy@example.se", password: "password123" })).status).toBe(409);
  });
  it("checks every field and says what is wrong", async () => {
    const cases: [unknown, number][] = [
      [null, 400], [[], 400], ["x", 400],
      [{ email: "not-an-email", password: "password123" }, 400],
      [{ email: ["a@b.se"], password: "password123" }, 400],
      [{ email: { $ne: null }, password: "password123" }, 400],
      [{ email: "a@b.se" }, 400],
      [{ email: "a@b.se", password: 12345678 }, 400],
      [{ email: "a@b.se", password: "short" }, 400],
      [{ email: "a@b.se", password: "x".repeat(73) }, 400],
      [{ email: "a@b.se", password: "é".repeat(40) }, 400], // 80 bytes
      [{ email: "a@b.se", password: "password123", name: { a: 1 } }, 400],
    ];
    for (const [body, status] of cases) expect((await signUp(body)).status, JSON.stringify(body)).toBe(status);
    expect((await signUp({ email: "a@b.se", password: "x".repeat(72) })).status).toBe(201);
    expect(await db.user.count()).toBe(2);
  });
  it("keeps the name tidy", async () => {
    const res = await signUp({ name: "  Ann‮\u0000 Lee ", email: "ann@b.se", password: "password123" });
    expect((await db.user.findFirst({ where: { id: (await res.json()).userId } }))?.name).toBe("Ann Lee");
  });
});

describe("sign-in", () => {
  it("accepts the address in any letters or padding for an existing account", async () => {
    for (const e of [OWNER, "SKANOVA@GMAIL.COM", "  Skanova@gmail.com "]) expect((await authorize(e, "owner-password"))?.id, e).toBe("owner");
  });
  it("rejects a wrong password, an unknown address and anything that is not an email", async () => {
    for (const [e, p] of [[OWNER, "wrong"], ["nobody@x.se", "owner-password"], ["not-an-email", "x"], [null, "x"], [OWNER, null], [{ a: 1 }, "x"]] as [unknown, unknown][]) {
      await expect(authorize(e, p), JSON.stringify([e, p])).rejects.toThrow();
    }
  });
  it("with older lookalike accounts, the password decides which account you get in to", async () => {
    await db.user.create({ data: { id: "evil", email: "SKANOVA@gmail.com", approved: false, password: await bcrypt.hash("evil-password", 4), createdAt: new Date("2026-06-01") } });
    expect((await authorize(OWNER, "owner-password"))?.id).toBe("owner");
    expect((await authorize("SKANOVA@gmail.com", "evil-password"))?.id).toBe("evil");
    await expect(authorize(OWNER, "evil-password-wrong")).rejects.toThrow();
  });
});

describe("the owner is a specific account, not whoever shows the address", () => {
  beforeEach(async () => {
    // Accounts that already exist from before the fix.
    await db.user.create({ data: { id: "evil1", email: "SKANOVA@gmail.com", approved: false, createdAt: new Date("2026-06-01") } });
    await db.user.create({ data: { id: "evil2", email: " skanova@gmail.com", approved: false, createdAt: new Date("2026-06-02") } });
    await db.user.create({ data: { id: "evil3", email: "Skanova@Gmail.com", approved: false, createdAt: new Date("2026-06-03") } });
  });
  it("the real owner is the owner, and no lookalike is, however the address is written", async () => {
    expect(await ownerUserId()).toBe("owner");
    expect(await isOwner("owner", OWNER)).toBe(true);
    for (const id of ["evil1", "evil2", "evil3"]) {
      const u = (await db.user.findUnique({ where: { id } }))!;
      expect(await isOwner(id, u.email), id).toBe(false);
      expect(await isOwner(id, OWNER), `${id} claiming the real address`).toBe(false);
      expect(await canUse(id, u.email), `${id} skips approval`).toBe(false);
    }
  });
  it("an unapproved lookalike gets in nowhere, and the real owner still passes", async () => {
    expect(await canUse("evil1", "SKANOVA@gmail.com")).toBe(false);
    expect(await canUse("owner", OWNER)).toBe(true);
  });
  it("does not matter how the owner's own address was typed when they signed up", async () => {
    await db.user.update({ where: { id: "owner" }, data: { email: "Skanova@GMAIL.com" } });
    expect(await isOwner("owner", "Skanova@GMAIL.com")).toBe(true);
    expect(await isOwner("evil1", "SKANOVA@gmail.com")).toBe(false);
  });
  it("without OWNER_EMAIL the first account is the owner, as before", async () => {
    delete process.env.OWNER_EMAIL;
    expect(await ownerUserId()).toBe("owner");
    expect(await isOwner("owner", null)).toBe(true);
    expect(await isOwner("evil1", "SKANOVA@gmail.com")).toBe(false);
  });
  it("nobody is the owner when no account holds the address", async () => {
    process.env.OWNER_EMAIL = "nobody@x.se";
    expect(await ownerUserId()).toBeNull();
    expect(await isOwner("owner", "nobody@x.se")).toBe(false);
  });
});

describe("Admin shows and removes lookalikes", () => {
  beforeEach(async () => {
    sess.user = { id: "owner", email: OWNER };
    await db.user.create({ data: { id: "evil1", email: "SKANOVA@gmail.com", approved: false, createdAt: new Date("2026-06-01") } });
    await db.user.create({ data: { id: "padded", email: " bob@x.se", approved: false, createdAt: new Date("2026-06-02") } });
    await db.user.create({ data: { id: "fine", email: "fine@x.se", approved: true, createdAt: new Date("2026-06-03") } });
  });
  const call = (id: string, body?: unknown) => removeUser(new Request("https://x", { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }), { params: { id } });

  it("marks the lookalike (and the real account is still the owner), and the padded one", async () => {
    const d = await (await listUsers()).json();
    const by = (id: string) => d.users.find((u: { id: string }) => u.id === id);
    expect(by("owner")).toMatchObject({ owner: true, emailWarning: "duplicate" });
    expect(by("evil1")).toMatchObject({ owner: false, emailWarning: "duplicate" });
    expect(by("padded")).toMatchObject({ owner: false, emailWarning: "padded" });
    expect(by("fine")).toMatchObject({ owner: false, emailWarning: null });
  });
  it("removes an empty lookalike, but never the owner or yourself, and only for the owner", async () => {
    expect((await call("owner")).status).toBe(400);
    expect((await call("evil1")).status).toBe(200);
    expect(await db.user.findUnique({ where: { id: "evil1" } })).toBeNull();
    expect((await call("nope")).status).toBe(404);
    sess.user = { id: "fine", email: "fine@x.se" };
    expect((await call("padded")).status).toBe(401);
    sess.user = null;
    expect((await call("padded")).status).toBe(401);
    expect(await db.user.findUnique({ where: { id: "padded" } })).not.toBeNull();
  });
  it("an account with work in it needs an explicit force", async () => {
    await db.project.create({ data: { id: "p", userId: "fine", name: "P", slug: "p", context: "" } });
    const res = await call("fine");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ projects: 1, ideas: 0 });
    expect(await db.user.findUnique({ where: { id: "fine" } })).not.toBeNull();
    expect((await call("fine", { force: true })).status).toBe(200);
    expect(await db.project.count()).toBe(0);
  });
});
