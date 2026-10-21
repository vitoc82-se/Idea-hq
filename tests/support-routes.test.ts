import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_FORM } from "@/lib/support/form-schema";
import { signBlob, deriveTicketToken, newTicketId } from "@/lib/support/tokens";
import type { PublicSpace, PublicTicket } from "@/lib/support/public-store";
import { EVAL_NOTES } from "@/lib/support/eval-set";

// Public support routes with the database layer replaced by an in-memory stand-in.
const store = vi.hoisted(() => ({
  space: null as unknown,
  ticket: null as unknown,
  hits: {} as Record<string, number>,
  created: [] as unknown[],
  replies: [] as { id: string; body: string }[],
  closedOnReply: false,
}));

vi.mock("@/lib/support/public-store", () => ({
  loadPublicSpace: vi.fn(async (key: unknown) => (store.space && (store.space as { key: string }).key === key ? store.space : null)),
  loadTicketByToken: vi.fn(async (token: unknown) => {
    const t = store.ticket as { token: string } | null;
    return t && t.token === token ? t : null;
  }),
  rateStore: { hit: vi.fn(async (key: string) => (store.hits[key] = (store.hits[key] || 0) + 1)) },
  createTicket: vi.fn(async (t: unknown) => {
    store.created.push(t);
    return { number: 12, token: "T".repeat(43) };
  }),
  addCustomerMessage: vi.fn(async (id: string, body: string) => {
    if (store.closedOnReply) return false;
    store.replies.push({ id, body });
    return true;
  }),
}));

const model = vi.hoisted(() => ({ calls: 0, reply: '{"decision":"answer","answer":"Open Settings, then Appearance, and switch Theme to Dark."}' }));
vi.mock("@/lib/support/ai-client", () => ({
  supportModelClient: () => ({
    messages: {
      create: async () => {
        model.calls++;
        return { content: [{ type: "text", text: model.reply }] };
      },
    },
  }),
}));

const retention = vi.hoisted(() => ({ ran: 0 }));
vi.mock("@/lib/support/retention", () => ({ runRetention: async () => { retention.ran++; return { spaces: 1, tickets: 2, buckets: 3 }; } }));

import { POST as ask } from "@/app/api/support/space/[key]/ask/route";
import { POST as submit } from "@/app/api/support/space/[key]/tickets/route";
import { GET as getTicket, POST as replyTicket } from "@/app/api/support/ticket/[token]/route";
import { GET as widgetPage } from "@/app/widget/[key]/route";
import { GET as helpPage } from "@/app/help/[key]/route";
import { GET as ticketPage } from "@/app/t/[token]/route";
import { GET as embedJs } from "@/app/embed/[file]/route";
import { GET as cron } from "@/app/api/cron/support-retention/route";

process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
const KEY = "ihq_AAAAAAAAAAAAAAAA";
const space = (over: Partial<PublicSpace> = {}): PublicSpace => ({
  id: "s1", projectId: "p1", key: KEY, title: "Acme", brandColor: "#047857", logoUrl: null, theme: "auto", allowedOrigins: ["https://shop.example.com"],
  form: { fields: [...DEFAULT_FORM.fields, { id: "order_number", label: "Order number", type: "text", required: true, maxLength: 20 }] },
  aiEnabled: true, aiDailyCap: 50, retentionDays: 365, replyTimeNote: "We reply within a day.", notifyEmail: "owner@acme.test", ownerEmail: "owner@x.se",
  projectName: "Acme", notes: EVAL_NOTES, ...over,
});

let fetchCalls: { url: string; body: string }[] = [];
let turnstileOk = true;

function req(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://ideahq.cloud${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const P = (key = KEY) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
  process.env.TURNSTILE_SECRET_KEY = "ts-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SUPPORT_FROM_EMAIL = "support@ideahq.cloud";
  process.env.SUPPORT_AI_ENABLED = "1";
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.CRON_SECRET = "c".repeat(32);
  delete process.env.SUPPORT_BASE_URL;
  store.space = space();
  store.ticket = null;
  store.hits = {};
  store.created = [];
  store.replies = [];
  store.closedOnReply = false;
  model.calls = 0;
  model.reply = '{"decision":"answer","answer":"Open Settings, then Appearance, and switch Theme to Dark."}';
  retention.ran = 0;
  fetchCalls = [];
  turnstileOk = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: turnstileOk }));
    return new Response("{}", { status: 200 });
  }));
});

const resendCalls = () => fetchCalls.filter((c) => c.url.includes("resend.com")).map((c) => JSON.parse(c.body));

describe("POST /api/support/space/[key]/ask", () => {
  const body = (over: Record<string, unknown> = {}) => ({ question: "How do I turn on dark mode?", token: "tok", ...over });
  it("404s for an unknown, disabled or malformed key", async () => {
    expect((await ask(req("/x", body()), P("ihq_BBBBBBBBBBBBBBBB"))).status).toBe(404);
    expect((await ask(req("/x", body()), P("nope"))).status).toBe(404);
  });
  it("refuses cross-site posts", async () => {
    expect((await ask(req("/x", body(), { origin: "https://evil.example" }), P())).status).toBe(403);
    expect(model.calls).toBe(0);
  });
  it("rejects missing or oversized bodies", async () => {
    expect((await ask(new Request("https://ideahq.cloud/x", { method: "POST", body: "not json" }), P())).status).toBe(400);
    expect((await ask(req("/x", { question: "x".repeat(20000) }), P())).status).toBe(400);
  });
  it("requires the bot check before any AI call", async () => {
    turnstileOk = false;
    const res = await ask(req("/x", body()), P());
    expect(res.status).toBe(403);
    expect(model.calls).toBe(0);
  });
  it("returns a signed answer from the help notes", async () => {
    const res = await ask(req("/x", body()), P());
    const d = await res.json();
    expect(d.kind).toBe("answer");
    expect(d.answer).toContain("Dark");
    expect(typeof d.blob).toBe("string");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("sends order and account questions to a person without calling the AI", async () => {
    const d = await (await ask(req("/x", body({ question: "Where is my order?" })), P())).json();
    expect(d).toEqual({ kind: "person", reason: "sensitive" });
    expect(model.calls).toBe(0);
  });
  it("falls back to the form when AI is off, has no notes, or the daily cap is hit", async () => {
    store.space = space({ aiEnabled: false });
    expect(await (await ask(req("/x", body()), P())).json()).toEqual({ kind: "person", reason: "unavailable" });
    store.space = space({ notes: [] });
    expect(await (await ask(req("/x", body()), P())).json()).toEqual({ kind: "person", reason: "unavailable" });
    store.space = space({ aiDailyCap: 1 });
    store.hits = {};
    await ask(req("/x", body()), P());
    expect(await (await ask(req("/x", body()), P())).json()).toEqual({ kind: "person", reason: "unavailable" });
    process.env.SUPPORT_AI_ENABLED = "0";
    store.space = space();
    model.calls = 0;
    expect(await (await ask(req("/x", body()), P())).json()).toEqual({ kind: "person", reason: "unavailable" });
    expect(model.calls).toBe(0);
  });
  it("rate-limits by address", async () => {
    let last = 200;
    for (let i = 0; i < 14; i++) last = (await ask(req("/x", body()), P())).status;
    expect(last).toBe(429);
  });
  it("an unsafe model answer becomes 'person'", async () => {
    model.reply = '{"decision":"answer","answer":"We will refund you. Open Settings, Appearance, Theme."}';
    expect(await (await ask(req("/x", body()), P())).json()).toEqual({ kind: "person", reason: "unsure" });
  });
});

describe("POST /api/support/space/[key]/tickets", () => {
  const good = (over: Record<string, unknown> = {}) => ({ email: "Cust@Example.com", message: "My thing is broken", fields: { order_number: "A-1" }, token: "tok", ...over });
  it("creates a ticket and emails the customer a private link and the owner a notice", async () => {
    const res = await submit(req("/x", good()), P());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, number: 12 });
    expect(store.created).toHaveLength(1);
    const t = store.created[0] as { email: string; subject: string; fields: { label: string; value: string }[] };
    expect(t.email).toBe("cust@example.com");
    expect(t.fields).toEqual([{ id: "order_number", label: "Order number", value: "A-1" }]);
    const mails = resendCalls();
    expect(mails).toHaveLength(2);
    const toCustomer = mails.find((m) => m.to[0] === "cust@example.com")!;
    expect(toCustomer.text).toContain("https://ideahq.cloud/t/" + "T".repeat(43));
    expect(toCustomer.text).toContain("We reply within a day.");
    const toOwner = mails.find((m) => m.to[0] === "owner@acme.test")!;
    expect(toOwner.subject).toContain("#12");
    expect(toOwner.text).toContain("https://ideahq.cloud/support");
    expect(toOwner.text).not.toContain("/t/");
  });
  it("the receipt says what to do if the person never wrote, and one address gets at most 3 a day", async () => {
    await submit(req("/x", good()), P());
    expect(resendCalls().find((m) => m.to[0] === "cust@example.com")!.text).toMatch(/If you did not contact us, you can ignore this email/);
    // two more receipts are fine, the fourth ticket is created but sends no receipt (the owner is still told)
    await submit(req("/x", good(), { "x-forwarded-for": "5.5.5.1" }), P());
    await submit(req("/x", good(), { "x-forwarded-for": "5.5.5.2" }), P());
    expect(resendCalls().filter((m) => m.to[0] === "cust@example.com")).toHaveLength(3);
    const fourth = await submit(req("/x", good(), { "x-forwarded-for": "5.5.5.3" }), P());
    expect(fourth.status).toBe(200);
    expect(resendCalls().filter((m) => m.to[0] === "cust@example.com")).toHaveLength(3);
    expect(resendCalls().filter((m) => m.to[0] === "owner@acme.test")).toHaveLength(4);
    expect(store.created).toHaveLength(4);
  });
  it("silently ignores a filled honeypot", async () => {
    const res = await submit(req("/x", good({ website: "http://spam.example" })), P());
    expect((await res.json()).ok).toBe(true);
    expect(store.created).toHaveLength(0);
    expect(resendCalls()).toHaveLength(0);
  });
  it("needs a passing bot check", async () => {
    turnstileOk = false;
    expect((await submit(req("/x", good()), P())).status).toBe(403);
    expect(store.created).toHaveLength(0);
  });
  it("returns field errors with 422 and creates nothing", async () => {
    const res = await submit(req("/x", good({ email: "nope", fields: {} })), P());
    expect(res.status).toBe(422);
    const d = await res.json();
    expect(d.errors.email).toBeTruthy();
    expect(d.errors.order_number).toBeTruthy();
    expect(store.created).toHaveLength(0);
  });
  it("rejects fields the form does not have", async () => {
    expect((await submit(req("/x", good({ fields: { order_number: "1", admin: "yes" } })), P())).status).toBe(422);
  });
  it("rate-limits per address, per email and per project", async () => {
    let status = 0;
    for (let i = 0; i < 8; i++) status = (await submit(req("/x", good({ email: `u${i}@example.com` })), P())).status;
    expect(status).toBe(429); // 6 per address per hour
    store.hits = {};
    status = 0;
    for (let i = 0; i < 5; i++) status = (await submit(req("/x", good(), { "x-forwarded-for": `198.51.100.${i}` }), P())).status;
    expect(status).toBe(429); // 4 per email per hour
  });
  it("attaches an AI answer only when the server signed it for this space", async () => {
    const blob = signBlob({ q: "How do I use dark mode?", a: "Open Settings.", k: "s1" });
    await submit(req("/x", good({ aiBlob: blob })), P());
    expect((store.created[0] as { aiAnswer: unknown }).aiAnswer).toEqual({ question: "How do I use dark mode?", answer: "Open Settings." });
    store.hits = {};
    const forged = signBlob({ q: "q", a: "a", k: "another-space" });
    await submit(req("/x", good({ aiBlob: forged, email: "b@example.com" }), { "x-forwarded-for": "198.51.100.77" }), P());
    expect((store.created[1] as { aiAnswer: unknown }).aiAnswer).toBeNull();
    await submit(req("/x", good({ aiBlob: "AAAA.BBBB", email: "c@example.com" }), { "x-forwarded-for": "198.51.100.78" }), P());
    expect((store.created[2] as { aiAnswer: unknown }).aiAnswer).toBeNull();
  });
  it("still saves the ticket when email cannot be sent", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("siteverify") ? new Response(JSON.stringify({ success: true })) : new Response("no", { status: 500 }))));
    const res = await submit(req("/x", good()), P());
    expect(res.status).toBe(200);
    expect(store.created).toHaveLength(1);
  });
  it("refuses cross-site posts and oversized bodies", async () => {
    expect((await submit(req("/x", good(), { origin: "https://evil.example" }), P())).status).toBe(403);
    expect((await submit(req("/x", good({ message: "x".repeat(40000) })), P())).status).toBe(400);
  });
  it("404s when support is off for the key", async () => {
    store.space = null;
    expect((await submit(req("/x", good()), P())).status).toBe(404);
  });
  it("keeps header-injection attempts out of email headers", async () => {
    await submit(req("/x", good({ message: "hi\r\nBcc: x@evil.com", fields: { order_number: "1" } })), P());
    for (const m of resendCalls()) {
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.from).not.toMatch(/[\r\n]/);
    }
  });
});

describe("customer ticket route", () => {
  const tok = deriveTicketToken(newTicketId());
  const ticket = (over: Partial<PublicTicket> = {}) => ({
    token: tok, id: "t1", number: 5, status: "pending", subject: "Broken", customerEmail: "c@example.com",
    messages: [{ author: "customer", body: "hi", createdAt: new Date().toISOString() }, { author: "owner", body: "we are on it", createdAt: new Date().toISOString() }],
    space: space(), ...over,
  });
  const T = (token = tok) => ({ params: Promise.resolve({ token }) });
  it("returns the conversation and nothing internal", async () => {
    store.ticket = ticket();
    const d = await (await getTicket(req("/x"), T())).json();
    expect(Object.keys(d).sort()).toEqual(["messages", "number", "status", "subject", "title"]);
    expect(JSON.stringify(d)).not.toMatch(/tokenHash|projectId|c@example.com/);
  });
  it("404s for bad, unknown and malformed tokens", async () => {
    store.ticket = ticket();
    expect((await getTicket(req("/x"), T("short"))).status).toBe(404);
    expect((await getTicket(req("/x"), T(deriveTicketToken("other")))).status).toBe(404);
    store.ticket = null;
    expect((await getTicket(req("/x"), T())).status).toBe(404);
  });
  it("accepts a reply, reopens the ticket and notifies the owner", async () => {
    store.ticket = ticket();
    const res = await replyTicket(req("/x", { body: "  thanks, still broken  " }), T());
    expect(res.status).toBe(200);
    expect(store.replies).toEqual([{ id: "t1", body: "thanks, still broken" }]);
    const mail = resendCalls().find((m) => m.to[0] === "owner@acme.test")!;
    expect(mail.subject).toContain("New reply on #5");
  });
  it("refuses replies on closed tickets, empty replies, long replies and cross-site posts", async () => {
    store.ticket = ticket({ status: "closed" });
    expect((await replyTicket(req("/x", { body: "hi" }), T())).status).toBe(409);
    store.ticket = ticket();
    expect((await replyTicket(req("/x", { body: "   " }), T())).status).toBe(422);
    expect((await replyTicket(req("/x", { body: "x".repeat(5001) }), T())).status).toBe(422);
    expect((await replyTicket(req("/x", { body: "hi" }, { origin: "https://evil.example" }), T())).status).toBe(403);
    store.closedOnReply = true;
    expect((await replyTicket(req("/x", { body: "hi" }), T())).status).toBe(409);
  });
  it("rate-limits replies", async () => {
    store.ticket = ticket();
    let status = 0;
    for (let i = 0; i < 22; i++) status = (await replyTicket(req("/x", { body: "hi" }), T())).status;
    expect(status).toBe(429);
  });
});

describe("public pages and embed script", () => {
  it("serves the widget with a strict CSP and frame-ancestors from the allow-list", async () => {
    const res = await widgetPage(req("/widget/" + KEY), P());
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'self' https://shop.example.com");
    expect(csp).toContain("default-src 'none'");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(html).toContain("Powered by Idea HQ");
    expect(html).toContain("Acme");
  });
  it("the plain link page cannot be framed", async () => {
    const res = await helpPage(req("/help/" + KEY), P());
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  it("404s with the same strict headers when support is off", async () => {
    store.space = null;
    for (const h of [widgetPage, helpPage]) {
      const res = await h(req("/x"), P());
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toBeTruthy();
    }
    expect((await embedJs(req("/embed/x.js"), { params: Promise.resolve({ file: KEY + ".js" }) })).status).toBe(404);
  });
  it("the ticket page is private: no referrer, no store, not indexed, not framable", async () => {
    store.ticket = { token: deriveTicketToken("x"), id: "t1", number: 5, status: "open", subject: "<img src=x onerror=alert(1)>", customerEmail: "c@example.com", messages: [{ author: "customer", body: "</script><script>alert(1)</script>", createdAt: new Date().toISOString() }], space: space() };
    const token = (store.ticket as { token: string }).token;
    const res = await ticketPage(req("/t/" + token), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/<\/script><script>alert/);
    expect((await ticketPage(req("/t/x"), { params: Promise.resolve({ token: "bad" }) })).status).toBe(404);
  });
  it("serves the embed script for a live space only", async () => {
    const res = await embedJs(req("/embed/" + KEY + ".js"), { params: Promise.resolve({ file: KEY + ".js" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const js = await res.text();
    expect(js).toContain(KEY);
    expect(js).toContain('"https://ideahq.cloud"');
    const blocked = await embedJs(req("/embed/" + KEY + ".js", undefined, { referer: "https://not-allowed.example/page" }), { params: Promise.resolve({ file: KEY + ".js" }) });
    expect(await blocked.text()).toContain("not available");
    const allowed = await embedJs(req("/embed/" + KEY + ".js", undefined, { referer: "https://shop.example.com/page" }), { params: Promise.resolve({ file: KEY + ".js" }) });
    expect(await allowed.text()).toContain("ORIGIN");
    expect((await embedJs(req("/embed/x"), { params: Promise.resolve({ file: KEY }) })).status).toBe(404);
    expect((await embedJs(req("/embed/x"), { params: Promise.resolve({ file: "../../etc/passwd.js" }) })).status).toBe(404);
  });
});

describe("retention cron", () => {
  it("only runs with the right bearer secret", async () => {
    for (const h of [undefined, "Bearer wrong", "Bearer " + "c".repeat(33), "c".repeat(32)]) {
      const r = new Request("https://ideahq.cloud/api/cron/support-retention", { headers: h ? { authorization: h } : {} });
      expect((await cron(r)).status).toBe(401);
    }
    expect(retention.ran).toBe(0);
    const ok = await cron(new Request("https://ideahq.cloud/x", { headers: { authorization: "Bearer " + "c".repeat(32) } }));
    expect(ok.status).toBe(200);
    expect(retention.ran).toBe(1);
  });
  it("refuses everyone when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(new Request("https://ideahq.cloud/x", { headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
  });
});
