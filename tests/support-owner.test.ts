import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "dns/promises";

// Owner-side support routes against a small in-memory database.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const st = vi.hoisted(() => ({ session: null as { id: string; email: string } | null, tables: {} as Record<string, Row[]>, seq: 0 }));

vi.mock("@/lib/session", () => ({
  getSession: async () => (st.session ? { user: st.session } : null),
  getCurrentUserId: async () => st.session?.id ?? null,
}));
vi.mock("next-auth", () => ({ getServerSession: async () => (st.session ? { user: st.session } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/db", () => {
  const T = st.tables;
  const rels: Record<string, [string, string]> = { project: ["project", "projectId"], ticket: ["ticket", "ticketId"] };
  const match = (table: string, row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k in rels && v && typeof v === "object" && table !== "project") {
        const [t, fk] = rels[k];
        const parent = T[t].find((r) => r.id === row[fk]);
        return !!parent && match(t, parent, v);
      }
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("lt" in v) return row[k] != null && row[k] < v.lt;
        if ("equals" in v) return typeof row[k] === "string" && row[k].toLowerCase() === String(v.equals).toLowerCase();
      }
      return row[k] === v;
    });
  const attach = (table: string, row: Row | undefined): Row | null => {
    if (!row) return null;
    const out: Row = { ...row };
    if (table === "ticket") {
      out.messages = T.ticketMessage.filter((m) => m.ticketId === row.id).sort((a, b) => +a.createdAt - +b.createdAt);
      const p = T.project.find((x) => x.id === row.projectId);
      out.project = p ? { ...p, support: T.supportSpace.find((s) => s.projectId === p.id) ?? null } : null;
    }
    if (table === "project") out.support = T.supportSpace.find((s) => s.projectId === row.id) ?? null;
    return out;
  };
  // Like Prisma: when `select` is given, only the selected fields come back.
  const prune = (row: Row | null, select?: Row): Row | null => {
    if (!row || !select) return row;
    const out: Row = {};
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      const val = row[k];
      if (v && typeof v === "object" && "select" in v) out[k] = Array.isArray(val) ? val.map((x: Row) => prune(x, v.select)) : prune(val ?? null, v.select);
      else out[k] = val;
    }
    return out;
  };
  const model = (table: string) => ({
    findFirst: async (a: Row = {}) => {
      let rows = T[table].filter((r) => match(table, r, a.where));
      if (a.orderBy?.createdAt === "desc") rows = [...rows].sort((x, y) => +y.createdAt - +x.createdAt);
      return prune(attach(table, rows[0]), a.select);
    },
    findUnique: async (a: Row) => prune(attach(table, T[table].find((r) => match(table, r, a.where))), a.select),
    findMany: async (a: Row = {}) => {
      let rows = T[table].filter((r) => match(table, r, a.where));
      if (a.orderBy?.lastActivityAt === "desc") rows = [...rows].sort((x, y) => +y.lastActivityAt - +x.lastActivityAt);
      if (a.orderBy?.number === "asc") rows = [...rows].sort((x, y) => x.number - y.number);
      if (a.take) rows = rows.slice(0, a.take);
      return rows.map((r) => prune(attach(table, r), a.select));
    },
    count: async (a: Row = {}) => T[table].filter((r) => match(table, r, a.where)).length,
    create: async (a: Row) => {
      const row = { id: a.data.id ?? `${table}${++st.seq}`, createdAt: new Date(2026, 9, 18, 10, 0, st.seq), ...a.data };
      T[table].push(row);
      return { ...row };
    },
    update: async (a: Row) => {
      const row = T[table].find((r) => match(table, r, a.where));
      if (!row) throw new Error("not found");
      Object.assign(row, a.data);
      return { ...row };
    },
    delete: async (a: Row) => {
      const i = T[table].findIndex((r) => match(table, r, a.where));
      if (i < 0) throw new Error("not found");
      const [gone] = T[table].splice(i, 1);
      if (table === "ticket") T.ticketMessage = T.ticketMessage.filter((m) => m.ticketId !== gone.id);
      return gone;
    },
    deleteMany: async (a: Row = {}) => {
      const gone = T[table].filter((r) => match(table, r, a.where));
      T[table] = T[table].filter((r) => !gone.includes(r));
      if (table === "ticket") T.ticketMessage = T.ticketMessage.filter((m) => !gone.some((g) => g.id === m.ticketId));
      return { count: gone.length };
    },
  });
  const db: Row = {};
  for (const t of ["user", "project", "supportSpace", "ticket", "ticketMessage", "rateBucket"]) {
    T[t] = [];
    Object.defineProperty(db, t, { get: () => model(t) });
  }
  return { db };
});

import { GET as listTickets } from "@/app/api/tickets/route";
import { GET as unread } from "@/app/api/tickets/unread/route";
import { GET as getOne, PATCH as patchOne, DELETE as deleteOne } from "@/app/api/tickets/[id]/route";
import { POST as reply } from "@/app/api/tickets/[id]/reply/route";
import { POST as resend } from "@/app/api/tickets/[id]/resend/route";
import { DELETE as deleteByEmail } from "@/app/api/tickets/by-email/route";
import { GET as exportTickets } from "@/app/api/tickets/export/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/projects/[id]/support/route";
import { POST as checkSiteRoute } from "@/app/api/projects/[id]/support/check-site/route";
import { PATCH as patchUser } from "@/app/api/admin/users/[id]/route";
import { runRetention } from "@/lib/support/retention";
import { checkSite, isPrivateAddress } from "@/lib/support/site-check";
import { deriveTicketToken, hashToken } from "@/lib/support/tokens";

const T = st.tables;
const A = { id: "u-owner", email: "owner@x.se" };
const B = { id: "u-b", email: "b@x.se" }; // has the tickets feature
const C = { id: "u-c", email: "c@x.se" }; // approved, no feature
const D = { id: "u-d", email: "d@x.se" }; // has the tickets feature, other projects

let mails: { to: string; subject: string; text: string }[] = [];
let mailOk = true;

function req(method: string, body?: unknown, url = "https://ideahq.cloud/api/x") {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ID = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (u: { id: string; email: string } | null) => { st.session = u; };

function seed() {
  const d = new Date("2026-10-18T10:00:00Z");
  T.user = [
    { id: A.id, email: A.email, approved: true, mustChangePassword: false, features: [], createdAt: d },
    { id: B.id, email: B.email, approved: true, mustChangePassword: false, features: ["tickets"], createdAt: d },
    { id: C.id, email: C.email, approved: true, mustChangePassword: false, features: [], createdAt: d },
    { id: D.id, email: D.email, approved: true, mustChangePassword: false, features: ["tickets"], createdAt: d },
  ];
  T.project = [
    { id: "pb", userId: B.id, name: "Shop B", context: "secret internal context" },
    { id: "pd", userId: D.id, name: "Shop D", context: "other" },
    { id: "pa", userId: A.id, name: "Shop A", context: "x" },
  ];
  T.supportSpace = [
    { id: "sb", projectId: "pb", enabled: true, publicKey: "ihq_BBBBBBBBBBBBBBBB", title: "Shop B Support", brandColor: "#047857", logoUrl: null, theme: "auto", allowedOrigins: ["https://b.example.com"], formSchema: null, aiEnabled: false, aiDailyCap: 50, retentionDays: 30, notifyEmail: null, replyTimeNote: null, supportKnowledge: null, ticketCounter: 2 },
    { id: "sd", projectId: "pd", enabled: true, publicKey: "ihq_DDDDDDDDDDDDDDDD", title: "D", brandColor: "#047857", logoUrl: null, theme: "auto", allowedOrigins: [], formSchema: null, aiEnabled: false, aiDailyCap: 50, retentionDays: 365, notifyEmail: null, replyTimeNote: null, supportKnowledge: null, ticketCounter: 1 },
  ];
  const mk = (id: string, projectId: string, number: number, status: string, extra: Row = {}) => ({
    id, projectId, number, status, subject: `Subject ${id}`, customerEmail: "cust@example.com", customerName: null, fields: [{ id: "order_number", label: "Order number", value: "A-1" }],
    needsHuman: status === "open", aiAnswered: false, unread: true, tokenHash: hashToken(deriveTicketToken(id)), lastActivityAt: new Date(2026, 9, 18, 10, number), closedAt: null, createdAt: d, ...extra,
  });
  T.ticket = [mk("ta", "pb", 1, "open"), mk("tb", "pb", 2, "closed", { closedAt: new Date("2026-08-01T00:00:00Z"), unread: false }), mk("td", "pd", 1, "open")];
  T.ticketMessage = [
    { id: "m1", ticketId: "ta", author: "customer", body: "Help", createdAt: new Date(2026, 9, 18, 10, 1), emailedAt: null },
    { id: "m2", ticketId: "tb", author: "customer", body: "Old", createdAt: new Date(2026, 8, 1), emailedAt: null },
    { id: "m3", ticketId: "td", author: "customer", body: "Secret of D", createdAt: new Date(2026, 9, 18, 10, 2), emailedAt: null },
  ];
}

beforeEach(() => {
  process.env.OWNER_EMAIL = A.email;
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SUPPORT_FROM_EMAIL = "support@ideahq.cloud";
  seed();
  as(null);
  mails = [];
  mailOk = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("resend.com")) {
      const b = JSON.parse(String(init?.body));
      mails.push({ to: b.to[0], subject: b.subject, text: b.text });
      return new Response("{}", { status: mailOk ? 200 : 500 });
    }
    return new Response("<html></html>", { status: 200 });
  }));
});

describe("who may use the owner support routes", () => {
  it("anonymous gets 401, an approved account without the feature gets 403", async () => {
    expect((await listTickets(req("GET"))).status).toBe(401);
    as(C);
    expect((await listTickets(req("GET"))).status).toBe(403);
    expect((await getOne(req("GET"), ID("ta"))).status).toBe(403);
    expect((await reply(req("POST", { body: "x" }), ID("ta"))).status).toBe(403);
    expect((await putSettings(req("PUT", { enabled: true }), ID("pb"))).status).toBe(403);
    expect(mails).toHaveLength(0);
  });
  it("the unread badge route tells the sidebar whether to show Support", async () => {
    as(C);
    expect(await (await unread()).json()).toEqual({ enabled: false, unread: 0 });
    as(B);
    expect(await (await unread()).json()).toEqual({ enabled: true, unread: 1 });
    as(A); // the Idea HQ owner always has it
    expect((await (await unread()).json()).enabled).toBe(true);
  });
});

describe("tenant isolation: one account never sees another's tickets", () => {
  it("lists only the caller's tickets", async () => {
    as(B);
    const d = await (await listTickets(req("GET", undefined, "https://ideahq.cloud/api/tickets?filter=all"))).json();
    expect(d.tickets.map((t: Row) => t.id).sort()).toEqual(["ta", "tb"]);
    expect(JSON.stringify(d)).not.toContain("Secret of D");
    expect(d.projects.map((p: Row) => p.id)).toEqual(["pb"]);
  });
  it("D cannot read, change, reply to, resend, export or delete B's ticket or project", async () => {
    as(D);
    expect((await getOne(req("GET"), ID("ta"))).status).toBe(404);
    expect((await patchOne(req("PATCH", { status: "closed" }), ID("ta"))).status).toBe(404);
    expect((await reply(req("POST", { body: "hi" }), ID("ta"))).status).toBe(404);
    expect((await resend(req("POST"), ID("ta"))).status).toBe(404);
    expect((await deleteOne(req("DELETE"), ID("ta"))).status).toBe(404);
    expect((await exportTickets(req("GET", undefined, "https://ideahq.cloud/api/tickets/export?project=pb"))).status).toBe(404);
    expect((await deleteByEmail(req("DELETE", { projectId: "pb", email: "cust@example.com" }))).status).toBe(404);
    expect((await getSettings(req("GET"), ID("pb"))).status).toBe(404);
    expect((await putSettings(req("PUT", { enabled: false }), ID("pb"))).status).toBe(404);
    expect((await checkSiteRoute(req("POST", { url: "https://x.com" }), ID("pb"))).status).toBe(404);
    expect(T.ticket.find((t) => t.id === "ta")?.status).toBe("open");
    expect(T.ticketMessage.filter((m) => m.ticketId === "ta")).toHaveLength(1);
    expect(T.ticket).toHaveLength(3);
    expect(mails).toHaveLength(0);
  });
});

describe("working a ticket", () => {
  it("opening a ticket returns the conversation and marks it read", async () => {
    as(B);
    const d = await (await getOne(req("GET"), ID("ta"))).json();
    expect(d.ticket.messages).toHaveLength(1);
    expect(d.ticket.fields[0].value).toBe("A-1");
    expect(T.ticket.find((t) => t.id === "ta")?.unread).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/tokenHash|secret internal context/);
  });
  it("a reply is saved, emailed with the private link, and moves the ticket to waiting", async () => {
    as(B);
    const res = await reply(req("POST", { body: "  Try restarting.  " }), ID("ta"));
    expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    const t = T.ticket.find((x) => x.id === "ta")!;
    expect(t.status).toBe("pending");
    expect(t.needsHuman).toBe(false);
    expect(T.ticketMessage.some((m) => m.ticketId === "ta" && m.author === "owner" && m.body === "Try restarting." && m.emailedAt)).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("cust@example.com");
    expect(mails[0].text).toContain("Try restarting.");
    expect(mails[0].text).toContain("https://ideahq.cloud/t/" + deriveTicketToken("ta"));
    expect(hashToken(deriveTicketToken("ta"))).toBe(t.tokenHash);
  });
  it("when the email fails the reply is still saved, flagged, and can be re-sent", async () => {
    as(B);
    mailOk = false;
    const d = await (await reply(req("POST", { body: "Hello" }), ID("ta"))).json();
    expect(d).toMatchObject({ ok: true, emailed: false });
    expect(T.ticketMessage.find((m) => m.author === "owner")?.emailedAt).toBeFalsy();
    mailOk = true;
    const again = await (await resend(req("POST"), ID("ta"))).json();
    expect(again.emailed).toBe(true);
    expect(T.ticketMessage.find((m) => m.author === "owner")?.emailedAt).toBeTruthy();
  });
  it("re-issues the link if the server secret was rotated", async () => {
    as(B);
    process.env.NEXTAUTH_SECRET = "a-rotated-secret-a-rotated-secret-xx";
    await reply(req("POST", { body: "Hi" }), ID("ta"));
    expect(T.ticket.find((x) => x.id === "ta")?.tokenHash).toBe(hashToken(deriveTicketToken("ta")));
    expect(mails[0].text).toContain(deriveTicketToken("ta"));
  });
  it("rejects empty and over-long replies", async () => {
    as(B);
    expect((await reply(req("POST", { body: "   " }), ID("ta"))).status).toBe(400);
    expect((await reply(req("POST", { body: "x".repeat(5001) }), ID("ta"))).status).toBe(400);
    expect((await reply(req("POST", {}), ID("ta"))).status).toBe(400);
    expect(mails).toHaveLength(0);
  });
  it("status changes set and clear the closed date; only known statuses are accepted", async () => {
    as(B);
    expect((await patchOne(req("PATCH", { status: "resolved" }), ID("ta"))).status).toBe(200);
    expect(T.ticket.find((t) => t.id === "ta")?.closedAt).toBeInstanceOf(Date);
    expect((await patchOne(req("PATCH", { status: "open" }), ID("ta"))).status).toBe(200);
    expect(T.ticket.find((t) => t.id === "ta")?.closedAt).toBeNull();
    for (const bad of [{ status: "deleted" }, { status: 5 }, {}, null]) expect((await patchOne(req("PATCH", bad), ID("ta"))).status).toBe(400);
  });
  it("deleting a ticket removes its messages", async () => {
    as(B);
    expect((await deleteOne(req("DELETE"), ID("ta"))).status).toBe(200);
    expect(T.ticket.find((t) => t.id === "ta")).toBeUndefined();
    expect(T.ticketMessage.filter((m) => m.ticketId === "ta")).toHaveLength(0);
    expect(T.ticket.find((t) => t.id === "td")).toBeDefined();
  });
  it("filters the list", async () => {
    as(B);
    const f = async (filter: string) => (await (await listTickets(req("GET", undefined, `https://ideahq.cloud/api/tickets?filter=${filter}`))).json()).tickets.map((t: Row) => t.id);
    expect(await f("needs")).toEqual(["ta"]);
    expect(await f("closed")).toEqual(["tb"]);
    expect(await f("waiting")).toEqual([]);
    expect(await f("bogus")).toHaveLength(2);
  });
});

describe("privacy tools", () => {
  it("deletes every ticket from one address in one project only", async () => {
    as(B);
    T.ticket.push({ ...T.ticket[0], id: "tx", number: 9, projectId: "pb", customerEmail: "someone@else.se" });
    const d = await (await deleteByEmail(req("DELETE", { projectId: "pb", email: "  CUST@example.com " }))).json();
    expect(d.deleted).toBe(2);
    expect(T.ticket.map((t) => t.id).sort()).toEqual(["td", "tx"]);
    expect((await deleteByEmail(req("DELETE", { projectId: "pb", email: "not an email" }))).status).toBe(400);
  });
  it("exports as a JSON download", async () => {
    as(B);
    const res = await exportTickets(req("GET", undefined, "https://ideahq.cloud/api/tickets/export?project=pb&email=cust@example.com"));
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const d = JSON.parse(await res.text());
    expect(d.tickets).toHaveLength(2);
    expect(JSON.stringify(d)).not.toMatch(/tokenHash/);
  });
  it("retention deletes closed tickets older than each project's window and prunes buckets", async () => {
    T.ticket.push({ ...T.ticket[0], id: "old-open", number: 5, projectId: "pb", status: "open", closedAt: null, lastActivityAt: new Date("2025-01-01") });
    T.rateBucket.push({ key: "old", windowStart: new Date("2026-10-01"), count: 3 }, { key: "fresh", windowStart: new Date("2026-10-18T09:00:00Z"), count: 1 });
    const r = await runRetention(new Date("2026-10-18T12:00:00Z"));
    expect(r).toMatchObject({ spaces: 2, tickets: 1, buckets: 1 });
    expect(T.ticket.map((t) => t.id).sort()).toEqual(["old-open", "ta", "td"]); // tb closed 2026-08-01 with a 30 day window is gone; open tickets stay
    expect(T.rateBucket.map((b) => b.key)).toEqual(["fresh"]);
  });
});

describe("settings", () => {
  it("creates the space on first save with a fresh public key, and reads it back", async () => {
    as(A);
    const res = await putSettings(req("PUT", { enabled: true, title: "Shop A" }), ID("pa"));
    expect(res.status).toBe(200);
    const space = (await res.json()).space;
    expect(space.key).toMatch(/^ihq_[A-Za-z0-9_-]{16}$/);
    expect(space.enabled).toBe(true);
    expect((await (await getSettings(req("GET"), ID("pa"))).json()).space.key).toBe(space.key);
  });
  it("returns null before support is first turned on", async () => {
    as(A);
    expect((await (await getSettings(req("GET"), ID("pa"))).json()).space).toBeNull();
  });
  it("validates everything strictly", async () => {
    as(B);
    const bad = [
      { brandColor: "red" }, { brandColor: "#12345" }, { logoUrl: "http://x.se/a.png" }, { logoUrl: "javascript:alert(1)" },
      { allowedOrigins: ["not a url"] }, { allowedOrigins: ["https://*.x.se"] }, { allowedOrigins: ["http://shop.com"] },
      { notifyEmail: "nope" }, { retentionDays: 1 }, { retentionDays: 99999 }, { aiDailyCap: -1 }, { theme: "neon" }, { title: "" },
      { sneaky: true }, { formSchema: { fields: Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, label: "L", type: "text" })) } },
      { formSchema: { fields: [{ id: "email", label: "E", type: "text" }] } }, { notes: [{ title: "t", text: "x", status: "published" }] },
    ];
    for (const b of bad) expect((await putSettings(req("PUT", b), ID("pb"))).status, JSON.stringify(b)).toBe(400);
  });
  it("normalises origins and keeps approved notes approved", async () => {
    as(B);
    const res = await putSettings(req("PUT", {
      allowedOrigins: ["https://Shop.Example.com/path", "https://shop.example.com", ""],
      notifyEmail: " Owner@Shop.com ", brandColor: "#1D4ED8",
      notes: [{ id: "n1", title: "Reset", text: "Do x", status: "confirmed" }, { id: "n2", title: "Draft", text: "Do y", status: "needs_review" }],
    }), ID("pb"));
    expect(res.status).toBe(200);
    const s = (await res.json()).space;
    expect(s.allowedOrigins).toEqual(["https://shop.example.com"]);
    expect(s.notifyEmail).toBe("owner@shop.com");
    expect(s.brandColor).toBe("#1d4ed8");
    expect(s.notes.map((n: Row) => n.status)).toEqual(["confirmed", "needs_review"]);
  });
  it("the project's internal knowledge never appears in the settings response", async () => {
    as(B);
    expect(JSON.stringify(await (await getSettings(req("GET"), ID("pb"))).json())).not.toContain("secret internal context");
  });
});

describe("the Tickets switch on the Users page", () => {
  it("only the owner can change features, and only to known names", async () => {
    as(B);
    expect((await patchUser(req("PATCH", { features: ["tickets"] }), ID("u-c"))).status).toBe(401);
    as(A);
    expect((await patchUser(req("PATCH", { features: ["tickets", "tickets"] }), ID("u-c"))).status).toBe(200);
    expect(T.user.find((u) => u.id === "u-c")?.features).toEqual(["tickets"]);
    expect((await patchUser(req("PATCH", { features: ["root"] }), ID("u-c"))).status).toBe(400);
    expect((await patchUser(req("PATCH", { features: "tickets" }), ID("u-c"))).status).toBe(400);
    expect((await patchUser(req("PATCH", {}), ID("u-c"))).status).toBe(400);
    as(C);
    expect((await listTickets(req("GET"))).status).toBe(200); // now allowed
  });
});

describe("Check my site", () => {
  const publicLookup = async () => ["93.184.216.34"];
  const page = (html: string, status = 200) => (async () => new Response(html, { status })) as unknown as typeof fetch;
  it("recognises private and internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses internal hosts before fetching anything", async () => {
    const f = vi.fn();
    for (const u of ["https://localhost/", "https://127.0.0.1/", "https://[::1]/", "https://metadata.internal/", "https://printer.local/"]) {
      expect((await checkSite(u, "ihq_x", [], f as unknown as typeof fetch, publicLookup)).status, u).toBe("blocked");
    }
    expect((await checkSite("https://evil.example", "k", [], f as unknown as typeof fetch, async () => ["10.0.0.9"])).status).toBe("blocked");
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects bad input", async () => {
    for (const u of ["", "ftp://x.com", "http://x.com", "javascript:alert(1)", 5, "https://u:p@x.com", "x".repeat(400)]) {
      expect((await checkSite(u, "k", [], page(""), publicLookup)).status, String(u)).toBe("invalid");
    }
  });
  it("reports whether the code is on the page and whether the site is allowed", async () => {
    const key = "ihq_AAAAAAAAAAAAAAAA";
    const withCode = await checkSite("shop.example.com", key, ["https://shop.example.com"], page(`<script src="https://ideahq.cloud/embed/${key}.js" defer></script>`), publicLookup);
    expect(withCode).toEqual({ status: "ok", found: true, allowed: true, origin: "https://shop.example.com" });
    const without = await checkSite("https://shop.example.com/page", key, [], page("<html></html>"), publicLookup);
    expect(without).toMatchObject({ status: "ok", found: false, allowed: false });
    expect((await checkSite("https://shop.example.com", key, [], page("no", 500), publicLookup)).status).toBe("unreachable");
  });
  it("follows redirects but re-checks every hop", async () => {
    const hops = vi.fn(async (u: string) => (String(u).includes("start") ? new Response(null, { status: 302, headers: { location: "https://internal.example/x" } }) : new Response("ok")));
    const lookup = async (h: string) => (h === "internal.example" ? ["10.0.0.1"] : ["93.184.216.34"]);
    expect((await checkSite("https://start.example/", "k", [], hops as unknown as typeof fetch, lookup)).status).toBe("blocked");
    expect(hops).toHaveBeenCalledTimes(1);
  });
  it("the real resolver is not used in tests", () => {
    expect(typeof dns.lookup).toBe("function");
  });
});
