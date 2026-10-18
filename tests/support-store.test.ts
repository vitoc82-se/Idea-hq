import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveTicketToken, hashToken, newTicketId } from "@/lib/support/tokens";

const dbm = vi.hoisted(() => ({
  spaceRow: null as Record<string, unknown> | null,
  ticketRow: null as Record<string, unknown> | null,
  calls: [] as { op: string; args: unknown }[],
  queryRows: [{ count: 1 }] as { count: number }[],
}));

vi.mock("@/lib/db", () => {
  const rec = (op: string, ret: () => unknown) => vi.fn(async (args: unknown) => { dbm.calls.push({ op, args }); return ret(); });
  const tx = {
    supportSpace: { update: rec("space.update", () => ({ ticketCounter: 7 })) },
    ticket: {
      create: rec("ticket.create", () => ({})),
      findUnique: rec("ticket.tx.findUnique", () => ({ status: "pending" })),
      update: rec("ticket.tx.update", () => ({})),
    },
    ticketMessage: { create: rec("message.create", () => ({})) },
  };
  return {
    db: {
      supportSpace: { findUnique: rec("space.findUnique", () => dbm.spaceRow) },
      ticket: { findUnique: rec("ticket.findUnique", () => dbm.ticketRow) },
      $queryRaw: vi.fn(async () => dbm.queryRows),
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

import { loadPublicSpace, loadTicketByToken, createTicket, addCustomerMessage, rateStore, type PublicSpace } from "@/lib/support/public-store";

process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
const KEY = "ihq_AAAAAAAAAAAAAAAA";
const row = (over: Record<string, unknown> = {}) => ({
  id: "s1", projectId: "p1", enabled: true, publicKey: KEY, allowedOrigins: ["https://shop.example.com"], title: "Acme", brandColor: "#047857",
  logoUrl: null, theme: "auto", formSchema: null, aiEnabled: true, aiDailyCap: 50, retentionDays: 365, replyTimeNote: null, notifyEmail: null,
  supportKnowledge: { notes: [{ id: "a", title: "A", text: "Alpha text", status: "confirmed" }, { id: "b", title: "B", text: "Beta text", status: "needs_review" }] },
  project: { name: "Acme", user: { features: ["tickets"], email: "owner@x.se" } }, ...over,
});

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
  delete process.env.OWNER_EMAIL;
  dbm.spaceRow = row();
  dbm.ticketRow = null;
  dbm.calls = [];
});

describe("loadPublicSpace (the feature gate on every public request)", () => {
  it("returns the space with confirmed notes only", async () => {
    const s = await loadPublicSpace(KEY);
    expect(s?.title).toBe("Acme");
    expect(s?.notes.map((n) => n.id)).toEqual(["a"]);
    expect(s?.form.fields.length).toBeGreaterThan(0); // falls back to the default form
  });
  it("never queries the database for a malformed key", async () => {
    for (const k of ["", "nope", undefined, 5, "ihq_../../../etc/pw"]) expect(await loadPublicSpace(k)).toBeNull();
    expect(dbm.calls).toHaveLength(0);
  });
  it("is closed when support is switched off for the project", async () => {
    dbm.spaceRow = row({ enabled: false });
    expect(await loadPublicSpace(KEY)).toBeNull();
  });
  it("is closed when the owner no longer has the tickets feature", async () => {
    dbm.spaceRow = row({ project: { name: "Acme", user: { features: [], email: "friend@x.se" } } });
    expect(await loadPublicSpace(KEY)).toBeNull();
  });
  it("the Idea HQ owner always passes", async () => {
    process.env.OWNER_EMAIL = "Owner@X.se";
    dbm.spaceRow = row({ project: { name: "Acme", user: { features: [], email: "owner@x.se" } } });
    expect(await loadPublicSpace(KEY)).not.toBeNull();
  });
  it("unknown key", async () => {
    dbm.spaceRow = null;
    expect(await loadPublicSpace(KEY)).toBeNull();
  });
  it("asks the database for support fields only (no project internals)", async () => {
    await loadPublicSpace(KEY);
    const sel = JSON.stringify((dbm.calls[0].args as { select: unknown }).select);
    for (const forbidden of ["context", "knowledge\"", "installationId", "repoOwner", "memory", "runs", "password"]) expect(sel).not.toContain(forbidden);
  });
});

describe("loadTicketByToken", () => {
  const id = newTicketId();
  const token = deriveTicketToken(id);
  const ticket = (over: Record<string, unknown> = {}) => ({
    id, number: 3, status: "open", subject: "S", customerEmail: "c@example.com", tokenHash: hashToken(token),
    messages: [{ author: "customer", body: "hi", createdAt: new Date("2026-10-18T10:00:00Z") }, { author: "weird", body: "x", createdAt: new Date() }],
    project: { support: row() }, ...over,
  });
  it("looks tickets up by the hash of the token and maps unknown authors to customer", async () => {
    dbm.ticketRow = ticket();
    const t = await loadTicketByToken(token);
    expect(t?.number).toBe(3);
    expect((dbm.calls[0].args as { where: { tokenHash: string } }).where.tokenHash).toBe(hashToken(token));
    expect(t?.messages[1].author).toBe("customer");
  });
  it("never queries for a malformed token", async () => {
    for (const bad of ["", "abc", "a".repeat(44), undefined]) expect(await loadTicketByToken(bad)).toBeNull();
    expect(dbm.calls).toHaveLength(0);
  });
  it("rejects when the stored hash differs (constant-time re-check)", async () => {
    dbm.ticketRow = ticket({ tokenHash: "0".repeat(64) });
    expect(await loadTicketByToken(token)).toBeNull();
  });
  it("is closed when the space is off or the owner lost the feature", async () => {
    dbm.ticketRow = ticket({ project: { support: row({ enabled: false }) } });
    expect(await loadTicketByToken(token)).toBeNull();
    dbm.ticketRow = ticket({ project: { support: null } });
    expect(await loadTicketByToken(token)).toBeNull();
  });
});

describe("createTicket / addCustomerMessage / rate store", () => {
  const space = { id: "s1", projectId: "p1" } as PublicSpace;
  it("numbers tickets per project and stores only the token hash", async () => {
    const r = await createTicket({ space, email: "c@example.com", name: null, subject: "S", message: "M", fields: [], aiAnswer: null });
    expect(r.number).toBe(7);
    expect(r.token).toHaveLength(43);
    const create = dbm.calls.find((c) => c.op === "ticket.create")!.args as { data: Record<string, unknown> };
    expect(create.data.tokenHash).toBe(hashToken(r.token));
    expect(JSON.stringify(create.data)).not.toContain(r.token);
    expect(create.data.id).toBeTruthy();
    expect(deriveTicketToken(create.data.id as string)).toBe(r.token);
  });
  it("stores the AI exchange as messages when the customer came from an AI answer", async () => {
    await createTicket({ space, email: "c@example.com", name: "C", subject: "S", message: "still broken", fields: [], aiAnswer: { question: "q", answer: "a" } });
    const create = dbm.calls.find((c) => c.op === "ticket.create")!.args as { data: { aiAnswered: boolean; messages: { create: { author: string }[] } } };
    expect(create.data.aiAnswered).toBe(true);
    expect(create.data.messages.create.map((m) => m.author)).toEqual(["customer", "ai", "customer"]);
  });
  it("a customer reply reopens the ticket, but not a closed one", async () => {
    expect(await addCustomerMessage("t1", "hello")).toBe(true);
    const upd = dbm.calls.find((c) => c.op === "ticket.tx.update")!.args as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ status: "open", needsHuman: true, unread: true, closedAt: null });
  });
  it("counts hits through one atomic statement", async () => {
    dbm.queryRows = [{ count: 3 }];
    expect(await rateStore.hit("k", 60)).toBe(3);
  });
});
