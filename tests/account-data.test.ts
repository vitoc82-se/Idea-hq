import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// A person can take their data with them and have the account removed, approved or not. Deleting must remove
// everything of theirs and nothing of anyone else's.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { GET as summary, DELETE as remove } from "@/app/api/auth/account/route";
import { GET as exportData } from "@/app/api/auth/account/export/route";
import { assertSessionCurrent, SESSION_REVOKED } from "@/lib/sessions";

const ann = { id: "ann", email: "ann@x.se" };
const del = (body: unknown) => remove(new Request("https://x/api/auth/account", { method: "DELETE", body: JSON.stringify(body) }));
const PASSWORD = "correct-password";

async function seedPerson(id: string, email: string | null, over: Record<string, unknown> = {}) {
  await db.user.create({ data: { id, email, name: id.toUpperCase(), approved: true, password: await bcrypt.hash(PASSWORD, 4), ...over } });
  await db.account.create({ data: { userId: id, type: "oauth", provider: "google", providerAccountId: `g-${id}`, access_token: `SECRET-ACCESS-${id}`, refresh_token: `SECRET-REFRESH-${id}` } });
  await db.session.create({ data: { userId: id, sessionToken: `SESSIONTOKEN-${id}`, expires: new Date(Date.now() + 1e9) } });
  await db.githubInstallation.create({ data: { userId: id, id: 77, accountLogin: id } });
  await db.project.create({ data: { id: `p-${id}`, userId: id, name: `Project of ${id}`, slug: id, context: `context ${id}` } });
  await db.idea.create({ data: { id: `i-${id}`, userId: id, projectId: `p-${id}`, title: `Idea of ${id}` } });
  await db.run.create({ data: { id: `r-${id}`, userId: id, projectId: `p-${id}`, ideaId: `i-${id}`, kind: "implement", status: "merged" } });
  await db.projectMemory.create({ data: { projectId: `p-${id}`, userId: id, text: `memory ${id}` } });
  await db.supportSpace.create({ data: { projectId: `p-${id}`, publicKey: `ihq_s_${id}`.padEnd(20, "x") } });
  await db.ticket.create({ data: { id: `t-${id}`, projectId: `p-${id}`, number: 1, subject: `ticket ${id}`, customerEmail: `cust-${id}@c.se`, tokenHash: `HASH-${id}`, fields: [] } });
  await db.ticketMessage.create({ data: { ticketId: `t-${id}`, author: "customer", body: `message ${id}` } });
  await db.changelogEntry.create({ data: { projectId: `p-${id}`, title: `entry ${id}`, kind: "new" } as never });
}
const counts = async (id: string) => ({
  user: await db.user.count({ where: { id } }), accounts: await db.account.count({ where: { userId: id } }), sessions: await db.session.count({ where: { userId: id } }),
  installs: await db.githubInstallation.count({ where: { userId: id } }), projects: await db.project.count({ where: { userId: id } }), ideas: await db.idea.count({ where: { userId: id } }),
  runs: await db.run.count({ where: { userId: id } }), memory: await db.projectMemory.count({ where: { userId: id } }), spaces: await db.supportSpace.count({ where: { projectId: `p-${id}` } }),
  tickets: await db.ticket.count({ where: { projectId: `p-${id}` } }), messages: await db.ticketMessage.count({ where: { ticketId: `t-${id}` } }), entries: await db.changelogEntry.count({ where: { projectId: `p-${id}` } }),
});
const EVERYTHING = { user: 1, accounts: 1, sessions: 1, installs: 1, projects: 1, ideas: 1, runs: 1, memory: 1, spaces: 1, tickets: 1, messages: 1, entries: 1 };
const NOTHING = Object.fromEntries(Object.keys(EVERYTHING).map((k) => [k, 0]));

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "owner@x.se";
  sess.user = ann;
  await db.user.create({ data: { id: "owner", email: "owner@x.se", approved: true, createdAt: new Date("2020-01-01") } });
  await seedPerson("ann", "ann@x.se");
  await seedPerson("bea", "bea@x.se");
});

describe("who can use it", () => {
  it("needs a signed-in person", async () => {
    sess.user = null;
    expect((await summary()).status).toBe(401);
    expect((await del({ confirm: "ann@x.se", password: PASSWORD })).status).toBe(401);
    expect((await exportData()).status).toBe(401);
    expect((await counts("ann")).projects).toBe(1);
  });
  it("works for someone who was never approved (they can leave and take their data)", async () => {
    await db.user.update({ where: { id: "ann" }, data: { approved: false } });
    expect((await exportData()).status).toBe(200);
    expect((await del({ confirm: "ann@x.se", password: PASSWORD })).status).toBe(200);
    expect(await counts("ann")).toEqual(NOTHING);
  });
});

describe("download my data", () => {
  it("is one JSON file with everything of theirs", async () => {
    const res = await exportData();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="idea-hq-data-\d{4}-\d\d-\d\d\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const d = JSON.parse(await res.text());
    expect(d.format).toBe("idea-hq-export-1");
    expect(d.account).toMatchObject({ id: "ann", email: "ann@x.se", name: "ANN", signInMethods: ["google"] });
    expect(d.projects.map((p: { id: string }) => p.id)).toEqual(["p-ann"]);
    expect(d.ideas.map((p: { id: string }) => p.id)).toEqual(["i-ann"]);
    expect(d.runs).toHaveLength(1);
    expect(d.projectMemory.map((m: { text: string }) => m.text)).toEqual(["memory ann"]);
    expect(d.supportSpaces).toHaveLength(1);
    expect(d.supportTickets[0].messages[0].body).toBe("message ann");
    expect(d.changelogEntries).toHaveLength(1);
    expect(d.githubConnections).toHaveLength(1);
  });
  it("holds nothing of anyone else's, and no secrets", async () => {
    const text = await (await exportData()).text();
    expect(text).not.toMatch(/bea|BEA/);
    expect(text).not.toMatch(/\$2[aby]\$/); // the password hash
    expect(text).not.toContain("SECRET-ACCESS");
    expect(text).not.toContain("SECRET-REFRESH");
    expect(text).not.toContain("HASH-ann"); // the ticket link hash
    expect(text).not.toContain("SESSIONTOKEN"); // session token
    expect(text).not.toMatch(/"password"/);
  });
  it("is limited to a few downloads an hour", async () => {
    for (let i = 0; i < 6; i++) expect((await exportData()).status).toBe(200);
    expect((await exportData()).status).toBe(429);
  });
});

describe("delete my account", () => {
  it("shows what it involves", async () => {
    expect(await (await summary()).json()).toEqual({ email: "ann@x.se", hasPassword: true, blocked: null });
  });
  it("asks for the email address and the password, and does nothing until both are right", async () => {
    for (const body of [{}, { confirm: "bea@x.se", password: PASSWORD }, { confirm: "ann@x.se" }, { confirm: "ann@x.se", password: "wrong" }, { confirm: "ann@x.se", password: "x".repeat(500) }, { confirm: 5, password: PASSWORD }]) {
      const res = await del(body);
      expect([400, 403], JSON.stringify(body)).toContain(res.status);
      expect(await counts("ann")).toEqual(EVERYTHING);
    }
  });
  it("accepts the address in any letters or padding", async () => {
    expect((await del({ confirm: "  ANN@X.se ", password: PASSWORD })).status).toBe(200);
  });
  it("removes everything of theirs, and only theirs", async () => {
    expect((await del({ confirm: "ann@x.se", password: PASSWORD })).status).toBe(200);
    expect(await counts("ann")).toEqual(NOTHING);
    expect(await counts("bea")).toEqual(EVERYTHING);
    expect(await db.user.count()).toBe(2); // owner and bea
  });
  it("every session of theirs stops working", async () => {
    await expect(assertSessionCurrent("ann", 0)).resolves.toBeUndefined();
    await del({ confirm: "ann@x.se", password: PASSWORD });
    await expect(assertSessionCurrent("ann", 0)).rejects.toThrow(SESSION_REVOKED);
  });
  it("keeps the payment ids (so a payment is never granted twice) but not who paid", async () => {
    await db.billingEvent.create({ data: { id: "order:1", userId: "ann" } });
    await del({ confirm: "ann@x.se", password: PASSWORD });
    expect(await db.billingEvent.findUnique({ where: { id: "order:1" } })).toMatchObject({ userId: null });
  });
  it("someone who signs in with Google only (no password) confirms with the address alone", async () => {
    await db.user.update({ where: { id: "ann" }, data: { password: null } });
    expect(await (await summary()).json()).toMatchObject({ hasPassword: false });
    expect((await del({ confirm: "ann@x.se" })).status).toBe(200);
  });
  it("an account without an address confirms by typing DELETE", async () => {
    await db.user.update({ where: { id: "ann" }, data: { email: null, password: null } });
    sess.user = { id: "ann", email: "" };
    expect((await del({ confirm: "ann@x.se" })).status).toBe(400);
    expect((await del({ confirm: "delete" })).status).toBe(200);
  });
  it("the owner account cannot be deleted here", async () => {
    sess.user = { id: "owner", email: "owner@x.se" };
    const info = await (await summary()).json();
    expect(info.blocked).toMatch(/owner account/);
    const res = await del({ confirm: "owner@x.se" });
    expect(res.status).toBe(409);
    expect(await db.user.count({ where: { id: "owner" } })).toBe(1);
  });
  it("a subscription that is still billing must be cancelled first; a cancelled or ended one does not block", async () => {
    for (const status of ["active", "on_trial", "past_due"]) {
      await db.user.update({ where: { id: "ann" }, data: { subStatus: status, subEndsAt: null } });
      expect((await (await summary()).json()).blocked, status).toMatch(/Cancel it first/);
      const res = await del({ confirm: "ann@x.se", password: PASSWORD });
      expect(res.status, status).toBe(409);
      expect(await db.user.count({ where: { id: "ann" } })).toBe(1);
    }
    await db.user.update({ where: { id: "ann" }, data: { subStatus: "cancelled", subEndsAt: new Date(Date.now() + 86_400_000) } });
    expect((await summary().then((r) => r.json())).blocked).toBeNull();
    expect((await del({ confirm: "ann@x.se", password: PASSWORD })).status).toBe(200);
  });
  it("guessing the password here is limited like signing in", async () => {
    for (let i = 0; i < 6; i++) expect((await del({ confirm: "ann@x.se", password: `guess-${i}-xx` })).status).toBe(403);
    expect((await del({ confirm: "ann@x.se", password: PASSWORD })).status).toBe(429);
    expect(await db.user.count({ where: { id: "ann" } })).toBe(1);
  });
});
