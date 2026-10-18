import { describe, it, expect, beforeEach } from "vitest";
import { cleanText, headerSafe, normalizeEmail, normalizeOrigin, safeHttpsUrl, escapeHtml, firstLine } from "@/lib/support/sanitize";
import { deriveTicketToken, newTicketId, hashToken, isTokenShape, newPublicKey, isKeyShape, signBlob, verifyBlob, bearerMatches, hashIdent, safeEqualHex } from "@/lib/support/tokens";
import { accentForWhiteText, accentForDarkBackground, contrastRatio, parseHex, isHexColor } from "@/lib/support/contrast";
import { validateFormDef, validateSubmission, parseFormDef, DEFAULT_FORM, type FormDef } from "@/lib/support/form-schema";
import { firstExceeded, RULES, clientIp, type RateStore } from "@/lib/support/ratelimit";
import { parseNotes, confirmedNotes, notesBlock } from "@/lib/support/notes";
import { verifyTurnstile } from "@/lib/support/turnstile";
import { sendEmail, customerReceiptEmail, customerReplyEmail, ticketLink } from "@/lib/support/email";
import { jsonForScript, securityHeaders, themeCss } from "@/lib/support/page-shell";
import { embedScript } from "@/lib/support/embed-script";
import { WIDGET_CLIENT, renderWidget, retentionText } from "@/lib/support/widget-html";
import { TICKET_CLIENT } from "@/lib/support/ticket-page";
import type { PublicSpace } from "@/lib/support/public-store";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
});

describe("sanitize", () => {
  it("strips control, bidi and zero-width characters and normalises newlines", () => {
    const evil = "a\u0000b\u202Ec\u200Bd\r\ne\rf\u0007";
    expect(cleanText(evil, 100)).toBe("abcd\ne\nf");
  });
  it("caps length and rejects non-strings", () => {
    expect(cleanText("x".repeat(50), 10)).toHaveLength(10);
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText(null, 10)).toBe("");
  });
  it("header-safe text has no line breaks (header injection)", () => {
    const h = headerSafe("Hello\r\nBcc: attacker@evil.com\u2028X-Y: 1");
    expect(h).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(h).toContain("Hello");
  });
  it("validates emails", () => {
    expect(normalizeEmail(" Person@Example.COM ")).toBe("person@example.com");
    for (const bad of ["", "a@b", "a b@c.se", "a@b.c", "a@b.se\r\nBcc: x@y.se", "<x@y.se>", "x@y.se,z@y.se", 5, null, "a".repeat(250) + "@b.se"]) {
      expect(normalizeEmail(bad as unknown)).toBeNull();
    }
  });
  it("normalises allowed origins", () => {
    expect(normalizeOrigin("https://Example.com/some/path?x=1")).toBe("https://example.com");
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://*.example.com", "https://user:pw@example.com", "not a url", "ftp://example.com", 3]) {
      expect(normalizeOrigin(bad as unknown)).toBeNull();
    }
  });
  it("only accepts https logo urls", () => {
    expect(safeHttpsUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    for (const bad of ["http://x.se/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "https://u:p@x.se/a.png", "", "x".repeat(600)]) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });
  it("escapes html", () => {
    expect(escapeHtml(`<img src=x onerror="a">'&`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;");
  });
  it("first line", () => {
    expect(firstLine("\n\n  Hello world \nsecond", 50)).toBe("Hello world");
    expect(firstLine("x".repeat(30), 10)).toHaveLength(10);
  });
});

describe("tokens", () => {
  it("ticket tokens are 256-bit, url-safe, stable per ticket, and only the hash is stored", () => {
    const id = newTicketId();
    const token = deriveTicketToken(id);
    expect(token).toHaveLength(43);
    expect(isTokenShape(token)).toBe(true);
    expect(deriveTicketToken(id)).toBe(token);
    expect(deriveTicketToken(newTicketId())).not.toBe(token);
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
  it("tokens depend on the server secret", () => {
    const id = newTicketId();
    const a = deriveTicketToken(id);
    process.env.NEXTAUTH_SECRET = "another-secret-another-secret-another";
    expect(deriveTicketToken(id)).not.toBe(a);
  });
  it("rejects malformed tokens and keys", () => {
    for (const bad of ["", "short", "a".repeat(44), "../etc/passwd", "a".repeat(42) + "!", undefined, 5]) expect(isTokenShape(bad)).toBe(false);
    expect(isKeyShape(newPublicKey())).toBe(true);
    for (const bad of ["ihq_", "ihq_short", "x".repeat(20), "ihq_" + "a".repeat(17), "ihq_../..........."]) expect(isKeyShape(bad)).toBe(false);
  });
  it("constant-time compare", () => {
    expect(safeEqualHex("abc", "abc")).toBe(true);
    expect(safeEqualHex("abc", "abd")).toBe(false);
    expect(safeEqualHex("abc", "abcd")).toBe(false);
  });
  it("signed blobs verify, expire and resist tampering", () => {
    const blob = signBlob({ q: "hi", a: "there" }, 1000, 5000);
    expect(verifyBlob(blob, 5500)).toMatchObject({ q: "hi", a: "there" });
    expect(verifyBlob(blob, 7000)).toBeNull(); // expired
    const [body, mac] = blob.split(".");
    const forged = Buffer.from(JSON.stringify({ q: "hi", a: "FORGED", exp: 99999999999999 })).toString("base64url");
    expect(verifyBlob(`${forged}.${mac}`, 5500)).toBeNull();
    expect(verifyBlob(`${body}.${mac}x`, 5500)).toBeNull();
    expect(verifyBlob("nope", 5500)).toBeNull();
    expect(verifyBlob(undefined, 5500)).toBeNull();
    expect(verifyBlob("x".repeat(9000), 5500)).toBeNull();
  });
  it("blobs signed with another secret are rejected", () => {
    const blob = signBlob({ a: 1 });
    process.env.NEXTAUTH_SECRET = "a-different-secret-a-different-secret";
    expect(verifyBlob(blob)).toBeNull();
  });
  it("hashes identifiers, never storing the raw value", () => {
    const h = hashIdent("203.0.113.9");
    expect(h).not.toContain("203");
    expect(h).toHaveLength(32);
  });
  it("bearer secret check", () => {
    const secret = "s".repeat(32);
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(bearerMatches(null, secret)).toBe(false);
    expect(bearerMatches("Bearer x", undefined)).toBe(false);
    expect(bearerMatches("Bearer short", "short")).toBe(false); // too-short secrets never pass
  });
});

describe("contrast", () => {
  it("default accent passes 4.5:1 with white", () => {
    expect(contrastRatio(parseHex("#047857")!, [255, 255, 255])).toBeGreaterThan(5.4);
  });
  it("darkens light colours until white text passes", () => {
    for (const c of ["#fde047", "#ffffff", "#a3e635", "#38bdf8", "#f97316", "#ff00ff"]) {
      const out = accentForWhiteText(c);
      expect(contrastRatio(parseHex(out)!, [255, 255, 255]), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps a colour that already passes", () => {
    expect(accentForWhiteText("#1d4ed8")).toBe("#1d4ed8");
  });
  it("lightens dark colours for the dark theme", () => {
    for (const c of ["#000000", "#1e3a8a", "#047857"]) {
      expect(contrastRatio(parseHex(accentForDarkBackground(c))!, [17, 24, 39]), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("falls back for junk input", () => {
    expect(accentForWhiteText("red; background:url(x)")).toBe("#047857");
    expect(isHexColor("#12ab3F")).toBe(true);
    expect(isHexColor("#12ab3")).toBe(false);
    expect(isHexColor("url(javascript:1)")).toBe(false);
  });
});

describe("form definition", () => {
  const ok = (f: unknown) => validateFormDef(f);
  it("accepts a sensible form and the default", () => {
    expect(ok({ fields: [{ id: "order_number", label: "Order number", type: "text", required: true }] }).ok).toBe(true);
    expect(ok(DEFAULT_FORM).ok).toBe(true);
    expect(ok({ fields: [] }).ok).toBe(true);
  });
  it("rejects more than 12 fields, duplicate and reserved ids, unknown keys and bad types", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, label: "L", type: "text" }));
    expect(ok({ fields: many }).ok).toBe(false);
    expect(ok({ fields: [{ id: "a", label: "A", type: "text" }, { id: "a", label: "B", type: "text" }] }).ok).toBe(false);
    for (const id of ["email", "message", "website", "token", "aiBlob"]) expect(ok({ fields: [{ id, label: "x", type: "text" }] }).ok, id).toBe(false);
    expect(ok({ fields: [{ id: "a", label: "A", type: "text", evil: 1 }] }).ok).toBe(false);
    expect(ok({ fields: [{ id: "a", label: "A", type: "html" }] }).ok).toBe(false);
    expect(ok({ fields: [{ id: "A-b", label: "A", type: "text" }] }).ok).toBe(false);
    expect(ok({ fields: [{ id: "a", label: "A", type: "select", options: ["only one"] }] }).ok).toBe(false);
    expect(ok({ fields: [], extra: 1 }).ok).toBe(false);
    expect(ok("nope").ok).toBe(false);
  });
  it("falls back to the default when stored data is junk", () => {
    expect(parseFormDef({ fields: "x" })).toEqual(DEFAULT_FORM);
    expect(parseFormDef(null)).toEqual(DEFAULT_FORM);
  });
});

describe("submission validation", () => {
  const def: FormDef = {
    fields: [
      { id: "name", label: "Your name", type: "text", required: false, maxLength: 20 },
      { id: "order_number", label: "Order number", type: "text", required: true, maxLength: 10 },
      { id: "topic", label: "Topic", type: "select", required: false, options: ["Shipping", "Other"] },
      { id: "agree", label: "Agree", type: "checkbox", required: false },
      { id: "qty", label: "Qty", type: "number", required: false },
    ],
  };
  const base = { email: "a@b.se", message: "Help me", fields: { order_number: "123" } };
  it("accepts a valid submission and snapshots labels", () => {
    const r = validateSubmission(def, { ...base, fields: { name: "Ann", order_number: "123", topic: "Other", agree: true, qty: "3" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Ann");
      expect(r.value.fields.map((f) => f.label)).toEqual(["Your name", "Order number", "Topic", "Agree", "Qty"]);
    }
  });
  it("always requires a valid email and a message", () => {
    for (const bad of [{ ...base, email: "" }, { ...base, email: "nope" }, { ...base, message: "  " }, { ...base, message: "x".repeat(5001) }]) {
      expect(validateSubmission(def, bad).ok).toBe(false);
    }
  });
  it("rejects unknown fields instead of ignoring them", () => {
    const r = validateSubmission(def, { ...base, fields: { order_number: "1", sneaky: "x" } });
    expect(r.ok).toBe(false);
  });
  it("enforces required, max length, choices, numbers and checkboxes", () => {
    expect(validateSubmission(def, { ...base, fields: {} }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: { order_number: "x".repeat(11) } }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: { order_number: "1", topic: "Hacking" } }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: { order_number: "1", qty: "abc" } }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: { order_number: "1", agree: "yes" } }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: { order_number: { $ne: 1 } } }).ok).toBe(false);
    expect(validateSubmission(def, { ...base, fields: [] }).ok).toBe(false);
  });
  it("rejects non-object bodies", () => {
    for (const bad of [null, "x", 5, [], undefined]) expect(validateSubmission(def, bad).ok).toBe(false);
  });
  it("keeps markup as inert text (it is never rendered as HTML)", () => {
    const r = validateSubmission(def, { ...base, message: "<script>alert(1)</script>" });
    expect(r.ok && r.value.message).toBe("<script>alert(1)</script>");
  });
});

describe("rate limiting", () => {
  const memory = (): RateStore & { n: Record<string, number> } => {
    const n: Record<string, number> = {};
    return { n, hit: async (k) => (n[k] = (n[k] || 0) + 1) };
  };
  it("returns the first rule that is over its limit", async () => {
    const s = memory();
    const rule = { key: "k", limit: 2, windowSec: 60 };
    expect(await firstExceeded(s, [rule])).toBeNull();
    expect(await firstExceeded(s, [rule])).toBeNull();
    expect(await firstExceeded(s, [rule])).toEqual(rule);
  });
  it("has per-address, per-email, per-project and AI rules", () => {
    expect(RULES.ticketIp("x").limit).toBeLessThanOrEqual(10);
    expect(RULES.ticketEmail("x").limit).toBeLessThanOrEqual(5);
    expect(RULES.ticketProjectDay("p").windowSec).toBe(86400);
    expect(RULES.aiProjectDay("p", 7).limit).toBe(7);
  });
  it("reads the client address from the edge header", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("help notes", () => {
  it("only confirmed notes reach customer-facing code", () => {
    const raw = { notes: [{ id: "a", title: "Reset", text: "Do x", status: "confirmed" }, { id: "b", title: "Draft", text: "Do y", status: "needs_review" }, { id: "c", title: "Weird", text: "Do z", status: "other" }] };
    expect(confirmedNotes(raw).map((n) => n.id)).toEqual(["a"]);
    expect(parseNotes(raw)).toHaveLength(3);
  });
  it("tolerates junk and caps size", () => {
    expect(parseNotes(null)).toEqual([]);
    expect(parseNotes({ notes: "x" })).toEqual([]);
    expect(parseNotes({ notes: [{ title: "", text: "x" }, 5, null] })).toEqual([]);
    expect(notesBlock(Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, title: "T", text: "x".repeat(1500), status: "confirmed" as const }))).length).toBeLessThanOrEqual(12000);
  });
});

describe("turnstile", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD };
  });
  it("fails closed without a secret in production", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(await verifyTurnstile("tok", "1.1.1.1")).toBe(false);
  });
  it("accepts only when the siteverify says success", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    const ok = (async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
    const no = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "1.1.1.1", ok)).toBe(true);
    expect(await verifyTurnstile("tok", "1.1.1.1", no)).toBe(false);
    expect(await verifyTurnstile("tok", "1.1.1.1", boom)).toBe(false);
    expect(await verifyTurnstile("", "1.1.1.1", ok)).toBe(false);
    expect(await verifyTurnstile(undefined, "1.1.1.1", ok)).toBe(false);
    expect(await verifyTurnstile({ a: 1 }, "1.1.1.1", ok)).toBe(false);
  });
});

describe("email", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD, RESEND_API_KEY: "re_test", SUPPORT_FROM_EMAIL: "support@ideahq.cloud" };
  });
  it("posts to Resend with sanitised headers and never throws", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => { sent = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const ok = await sendEmail({ to: "a@b.se", subject: "Hi\r\nBcc: x@y.se", text: "body", fromName: 'Evil" <x@y.se>\r\nBcc: z' }, f);
    expect(ok).toBe(true);
    const body = JSON.parse(String(sent!.init.body));
    expect(body.subject).not.toMatch(/[\r\n]/);
    expect(body.from).not.toMatch(/[\r\n]/);
    expect(body.from.endsWith("<support@ideahq.cloud>")).toBe(true);
    expect(body.to).toEqual(["a@b.se"]);
    const fail = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    expect(await sendEmail({ to: "a@b.se", subject: "s", text: "t", fromName: "X" }, fail)).toBe(false);
    const boom = (async () => { throw new Error("x"); }) as unknown as typeof fetch;
    expect(await sendEmail({ to: "a@b.se", subject: "s", text: "t", fromName: "X" }, boom)).toBe(false);
  });
  it("does nothing without configuration", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendEmail({ to: "a@b.se", subject: "s", text: "t", fromName: "X" })).toBe(false);
  });
  it("templates contain the private link and no html", () => {
    const link = ticketLink("T".repeat(43));
    expect(link).toBe("https://ideahq.cloud/t/" + "T".repeat(43));
    const r = customerReceiptEmail({ title: "Acme", number: 7, link, replyTime: "We reply within a day." });
    expect(r.text).toContain(link);
    expect(r.text).toContain("We reply within a day.");
    const rep = customerReplyEmail({ title: "Acme", number: 7, link, body: "Try this", status: "pending" });
    expect(rep.text).toContain("Try this");
    expect(rep.text).toContain("Waiting for your reply");
  });
});

const space: PublicSpace = {
  id: "s1", projectId: "p1", key: "ihq_AAAAAAAAAAAAAAAA", title: 'Acme </title><script>alert(1)</script>', brandColor: "#fde047", logoUrl: "https://cdn.example.com/l.png",
  theme: "auto", allowedOrigins: ["https://shop.example.com"], form: DEFAULT_FORM, aiEnabled: true, aiDailyCap: 50, retentionDays: 365,
  replyTimeNote: "We reply <b>fast</b>", notifyEmail: null, ownerEmail: null, projectName: "Acme", notes: [],
};

describe("public pages", () => {
  it("client scripts parse as JavaScript", () => {
    expect(() => new Function(WIDGET_CLIENT)).not.toThrow();
    expect(() => new Function(TICKET_CLIENT)).not.toThrow();
    expect(() => new Function(embedScript("ihq_AAAAAAAAAAAAAAAA", "https://ideahq.cloud", "#047857"))).not.toThrow();
  });
  it("client scripts never use innerHTML or eval", () => {
    for (const code of [WIDGET_CLIENT, TICKET_CLIENT, embedScript("ihq_AAAAAAAAAAAAAAAA", "https://ideahq.cloud", "#047857")]) {
      expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    }
  });
  it("escapes owner-controlled strings in the shell and config", () => {
    const { html } = renderWidget(space, { aiAvailable: true, page: false });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;");
    const cfg = html.split('id="cfg">')[1].split("</script>")[0];
    expect(cfg).not.toContain("<");
    expect(JSON.parse(cfg).replyTime).toBe("We reply <b>fast</b>");
  });
  it("jsonForScript cannot break out of a script block", () => {
    const out = jsonForScript({ a: "</script><script>x", b: "\u2028" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).a).toBe("</script><script>x");
  });
  it("sets a strict CSP: nonce scripts, only the allowed sites may frame the widget", () => {
    const { headers, html } = renderWidget(space, { aiAvailable: true, page: false });
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/frame-ancestors 'self' https:\/\/shop\.example\.com/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    const nonce = /nonce-([^'; ]+)/.exec(csp)![1];
    expect(html).toContain(`nonce="${nonce}"`);
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Robots-Tag"]).toContain("noindex");
  });
  it("the plain-link page cannot be framed and a widget with no sites allows only itself", () => {
    expect(renderWidget(space, { aiAvailable: true, page: true }).headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    const none = renderWidget({ ...space, allowedOrigins: [] }, { aiAvailable: true, page: false }).headers["Content-Security-Policy"];
    expect(none).toMatch(/frame-ancestors 'self'$/);
  });
  it("only allows Turnstile when a site key exists", () => {
    expect(securityHeaders({ nonce: "n", frameAncestors: [], turnstile: true })["Content-Security-Policy"]).toContain("challenges.cloudflare.com");
    expect(securityHeaders({ nonce: "n", frameAncestors: [], turnstile: false })["Content-Security-Policy"]).not.toContain("cloudflare");
  });
  it("theme css keeps text readable", () => {
    const css = themeCss({ title: "x", brandColor: "#fde047", logoUrl: null, theme: "auto" });
    const accent = /--accent:(#[0-9a-f]{6})/.exec(css)![1];
    expect(contrastRatio(parseHex(accent)!, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });
  it("retention wording", () => {
    expect(retentionText(30)).toBe("30 days");
    expect(retentionText(365)).toBe("a year");
    expect(retentionText(90)).toBe("3 months");
    expect(retentionText(730)).toBe("2 years");
  });
});
