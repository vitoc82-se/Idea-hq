import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";

// Sign-in and sign-up were wide open: unlimited password guesses, unlimited account creation, and
// anyone could register someone else's address. These tests pin the brakes (limits, the "are you a
// person" check, email confirmation) and that one person's trouble never locks out another.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], ok: true }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
vi.mock("@/lib/support/email", () => ({
  baseUrl: () => "https://ideahq.cloud",
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    mail.sent.push(m);
    return mail.ok;
  },
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import { GET as verificationStatus, POST as resend } from "@/app/api/auth/verification/route";
import { GET as turnstileKey } from "@/app/api/auth/turnstile/route";
import { authOptions } from "@/lib/auth";
import { AUTH_RULES, TOO_MANY_LOGINS, ipFrom } from "@/lib/auth-limits";
import { rateStore } from "@/lib/support/public-store";
import { verifyTurnstile } from "@/lib/support/turnstile";
import { makeVerifyToken, readVerifyToken, confirmEmail, isVerified } from "@/lib/email-verification";

const EMAIL = "ann@example.se";
const credentialsProvider = authOptions.providers.find((p) => p.id === "credentials") as unknown as {
  options: { authorize: (c: Record<string, unknown>, req?: { headers: Record<string, string> }) => Promise<{ id: string } | null> };
};
const login = (email: unknown, password: unknown, ip = "1.1.1.1") =>
  credentialsProvider.options.authorize({ email, password }, { headers: { "x-forwarded-for": ip } });
const signUp = (body: unknown, ip = "2.2.2.2") =>
  register(new Request("https://x/api/auth/register", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const confirm = (token: unknown, ip = "3.3.3.3") =>
  verifyEmail(new Request("https://x/api/auth/verify-email", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ token }) }));
const fill = async (rule: { key: string; limit: number; windowSec: number }) => {
  for (let i = 0; i < rule.limit; i++) await rateStore.hit(rule.key, rule.windowSec);
};

beforeEach(async () => {
  await resetDb();
  mail.sent = [];
  mail.ok = true;
  sess.user = null;
  process.env.SUPPORT_TURNSTILE_BYPASS = "1";
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.REGISTER_CAPTCHA;
  await db.user.create({ data: { id: "ann", email: EMAIL, approved: true, password: await bcrypt.hash("right-password", 4) } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sign-in limits", () => {
  it("lets the right password in", async () => {
    expect((await login(EMAIL, "right-password"))?.id).toBe("ann");
  });
  it("stops guessing at one account from one place, even for the right password afterwards", async () => {
    for (let i = 0; i < 8; i++) await expect(login(EMAIL, `guess-${i}`)).rejects.toThrow("Invalid credentials");
    await expect(login(EMAIL, "right-password")).rejects.toThrow(TOO_MANY_LOGINS);
  });
  it("does not lock the real owner out when someone else is guessing from another place", async () => {
    for (let i = 0; i < 8; i++) await expect(login(EMAIL, `guess-${i}`, "6.6.6.6")).rejects.toThrow("Invalid credentials");
    await expect(login(EMAIL, "right-password", "6.6.6.6")).rejects.toThrow(TOO_MANY_LOGINS);
    expect((await login(EMAIL, "right-password", "7.7.7.7"))?.id).toBe("ann");
  });
  it("one place trying other accounts is not blocked by the first account's limit", async () => {
    await fill(AUTH_RULES.loginPair("1.1.1.1", EMAIL));
    await expect(login(EMAIL, "right-password")).rejects.toThrow(TOO_MANY_LOGINS);
    await expect(login("other@example.se", "x")).rejects.toThrow("Invalid credentials");
  });
  it("stops one place from trying lots of different accounts", async () => {
    await fill(AUTH_RULES.loginIp("8.8.8.8"));
    await expect(login(EMAIL, "right-password", "8.8.8.8")).rejects.toThrow(TOO_MANY_LOGINS);
    expect((await login(EMAIL, "right-password", "9.9.9.9"))?.id).toBe("ann");
  });
  it("stops a spread-out attack on one account from many places", async () => {
    await fill(AUTH_RULES.loginEmail(EMAIL));
    await expect(login(EMAIL, "right-password", "4.4.4.4")).rejects.toThrow(TOO_MANY_LOGINS);
  });
  it("counts the address in any letters or padding as the same account", async () => {
    for (let i = 0; i < 8; i++) await expect(login(i % 2 ? " ANN@example.se " : EMAIL, `guess-${i}`)).rejects.toThrow("Invalid credentials");
    await expect(login("Ann@Example.SE", "right-password")).rejects.toThrow(TOO_MANY_LOGINS);
  });
  it("says the same thing for an unknown address as for a wrong password", async () => {
    const unknown = await login("nobody@example.se", "whatever1").catch((e) => (e as Error).message);
    const wrong = await login(EMAIL, "whatever1").catch((e) => (e as Error).message);
    expect(unknown).toBe("Invalid credentials");
    expect(wrong).toBe(unknown);
  });
  it("spends a password check even when there is no such account (no timing difference)", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expect(login("nobody@example.se", "whatever1")).rejects.toThrow();
    await expect(login("not-an-email", "whatever1")).rejects.toThrow();
    expect(compare).toHaveBeenCalledTimes(2);
    // ...and the stand-in hash is a real bcrypt hash, so the time matches a real check.
    for (const call of compare.mock.calls) expect(String(call[1])).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });
  it("does not hash enormous passwords", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expect(login(EMAIL, "x".repeat(5000))).rejects.toThrow("Invalid credentials");
    expect(compare).not.toHaveBeenCalled();
  });
  it("an account that signed up with Google only (no password) is not an open door", async () => {
    await db.user.create({ data: { id: "g", email: "g@example.se", approved: true } });
    await expect(login("g@example.se", "anything1")).rejects.toThrow("Invalid credentials");
    await expect(login("g@example.se", "")).rejects.toThrow();
  });
  it("reads the caller's address from whatever headers it is given", () => {
    expect(ipFrom({ "x-forwarded-for": "5.5.5.5, 10.0.0.1" })).toBe("5.5.5.5");
    expect(ipFrom(new Headers({ "x-forwarded-for": "5.5.5.6" }))).toBe("5.5.5.6");
    expect(ipFrom(undefined)).toBe("unknown");
    expect(ipFrom({ "x-forwarded-for": ["a", "b"] })).toBe("unknown");
  });
});

describe("sign-up limits", () => {
  it("allows a few sign-ups an hour from one place, then stops", async () => {
    for (let i = 0; i < 5; i++) expect((await signUp({ email: `p${i}@example.se`, password: "short" })).status).toBe(400);
    const sixth = await signUp({ email: "p6@example.se", password: "password123" });
    expect(sixth.status).toBe(429);
    expect(await db.user.count({ where: { email: "p6@example.se" } })).toBe(0);
    // someone elsewhere is not affected
    expect((await signUp({ email: "p7@example.se", password: "password123" }, "2.2.9.9")).status).toBe(201);
  });
  it("allows one address only a few tries an hour, from anywhere", async () => {
    for (let i = 0; i < 3; i++) expect((await signUp({ email: "target@example.se", password: "short" }, `2.2.3.${i}`)).status).toBe(400);
    expect((await signUp({ email: "target@example.se", password: "password123" }, "2.2.3.9")).status).toBe(429);
    expect((await signUp({ email: "TARGET@example.se ", password: "password123" }, "2.2.3.10")).status, "same address, other letters").toBe(429);
  });
  it("is not limited by sign-in guessing, and not the other way round", async () => {
    await fill(AUTH_RULES.loginIp("2.2.2.2"));
    expect((await signUp({ email: "fresh@example.se", password: "password123" })).status).toBe(201);
  });
});

describe("the 'are you a person' check on sign-up", () => {
  it("refuses sign-up without it once the check is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false })));
    vi.stubGlobal("fetch", fetchMock);
    const none = await signUp({ email: "b1@example.se", password: "password123" });
    expect(none.status).toBe(403);
    const bad = await signUp({ email: "b2@example.se", password: "password123", token: "tok" });
    expect(bad.status).toBe(403);
    expect(await db.user.count()).toBe(1);
  });
  it("accepts sign-up when the check passes", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    expect((await signUp({ email: "ok@example.se", password: "password123", token: "tok" })).status).toBe(201);
  });
  it("refuses in production when it is not configured (fails closed), whatever the bypass says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await verifyTurnstile("tok", "1.1.1.1")).toBe(false);
    expect((await signUp({ email: "prod@example.se", password: "password123" })).status).toBe(403);
  });
  it("has an emergency switch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REGISTER_CAPTCHA", "off");
    expect((await signUp({ email: "switch@example.se", password: "password123" })).status).toBe(201);
    expect(await (await turnstileKey()).json()).toEqual({ siteKey: "" });
  });
  it("tells the sign-up page which site key to use", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    expect(await (await turnstileKey()).json()).toEqual({ siteKey: "site-key" });
  });
});

describe("confirming an email address", () => {
  it("sign-up sends a link, and the link works", async () => {
    const res = await signUp({ name: "Bea Lund", email: "Bea@Example.se", password: "password123" });
    expect(res.status).toBe(201);
    const { userId } = await res.json();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("bea@example.se");
    const link = mail.sent[0].text.match(/https:\/\/ideahq\.cloud\/auth\/verify\?token=\S+/)?.[0];
    expect(link).toBeTruthy();
    expect(await isVerified(userId)).toBe(false);
    const token = decodeURIComponent(new URL(link!).searchParams.get("token")!);
    expect((await confirm(token)).status).toBe(200);
    expect(await isVerified(userId)).toBe(true);
    expect((await db.user.findUnique({ where: { id: userId } }))?.emailVerified).toBeInstanceOf(Date);
  });
  it("sign-up still works when the email cannot be sent", async () => {
    mail.ok = false;
    expect((await signUp({ email: "nomail@example.se", password: "password123" })).status).toBe(201);
  });
  it("the link only shows a page; confirming is a POST (mail scanners cannot confirm it)", async () => {
    const route = await import("@/app/api/auth/verify-email/route");
    expect(Object.keys(route).filter((k) => /^(GET|HEAD|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
  it("a link is tied to one account and one exact address", async () => {
    const t = makeVerifyToken("ann", EMAIL);
    expect(readVerifyToken(t)).toEqual({ userId: "ann", email: EMAIL });
    // address changed since the link was sent
    await db.user.update({ where: { id: "ann" }, data: { email: "changed@example.se" } });
    expect(await confirmEmail(t)).toBe("invalid");
    expect((await db.user.findUnique({ where: { id: "ann" } }))?.emailVerified).toBeNull();
    // someone else's id
    expect(await confirmEmail(makeVerifyToken("nobody", EMAIL))).toBe("invalid");
  });
  it("rejects expired, tampered, forged and silly links", async () => {
    const now = Date.now();
    const old = makeVerifyToken("ann", EMAIL, now - 4 * 24 * 60 * 60 * 1000);
    expect(readVerifyToken(old, now)).toBeNull();
    expect(readVerifyToken(makeVerifyToken("ann", EMAIL, now), now + 2 * 24 * 60 * 60 * 1000)).not.toBeNull();
    const good = makeVerifyToken("ann", EMAIL);
    const [body, mac] = good.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ u: "ann", e: EMAIL, x: Date.now() + 1e12 })).toString("base64url");
    for (const bad of [`${forgedBody}.${mac}`, `${body}.${mac.slice(0, -2)}xx`, body, "", ".", "a.b", good + "x", "x".repeat(2000), 42, null, undefined, { a: 1 }]) {
      expect(readVerifyToken(bad), String(bad).slice(0, 30)).toBeNull();
    }
    vi.stubEnv("NEXTAUTH_SECRET", "another-secret-another-secret-12345");
    expect(readVerifyToken(good), "signed with a different secret").toBeNull();
  });
  it("the route says 400 for a bad link and does not confirm anyone", async () => {
    for (const t of ["junk", "", null, 12]) expect((await confirm(t)).status).toBe(400);
    const res = await verifyEmail(new Request("https://x/api/auth/verify-email", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await db.user.findUnique({ where: { id: "ann" } }))?.emailVerified).toBeNull();
  });
  it("the route is rate limited per place", async () => {
    for (let i = 0; i < 20; i++) expect((await confirm("junk", "3.3.4.4")).status).toBe(400);
    expect((await confirm(makeVerifyToken("ann", EMAIL), "3.3.4.4")).status).toBe(429);
    expect((await confirm(makeVerifyToken("ann", EMAIL), "3.3.4.5")).status).toBe(200);
  });
  it("confirming twice is harmless and keeps the first time", async () => {
    const t = makeVerifyToken("ann", EMAIL);
    expect(await confirmEmail(t)).toBe("ok");
    const first = (await db.user.findUnique({ where: { id: "ann" } }))!.emailVerified!;
    expect(await confirmEmail(t)).toBe("ok");
    expect((await db.user.findUnique({ where: { id: "ann" } }))!.emailVerified!.getTime()).toBe(first.getTime());
  });
  it("signing in with Google counts as confirmed", async () => {
    await db.user.create({ data: { id: "goog", email: "goog@example.se" } });
    await db.account.create({ data: { userId: "goog", type: "oauth", provider: "google", providerAccountId: "123" } });
    expect(await isVerified("goog")).toBe(true);
    expect(await isVerified("ann")).toBe(false);
    expect(await isVerified("missing")).toBe(false);
  });
});

describe("asking for the email again", () => {
  it("needs a signed-in person", async () => {
    expect((await verificationStatus()).status).toBe(401);
    expect((await resend()).status).toBe(401);
  });
  it("reports whether the address is confirmed", async () => {
    sess.user = { id: "ann", email: EMAIL };
    expect(await (await verificationStatus()).json()).toEqual({ verified: false });
    await confirmEmail(makeVerifyToken("ann", EMAIL));
    expect(await (await verificationStatus()).json()).toEqual({ verified: true });
  });
  it("sends a fresh link, a few times an hour at most", async () => {
    sess.user = { id: "ann", email: EMAIL };
    for (let i = 0; i < 3; i++) expect((await resend()).status).toBe(200);
    expect(mail.sent).toHaveLength(3);
    const blocked = await resend();
    expect(blocked.status).toBe(429);
    expect(mail.sent).toHaveLength(3);
    expect((await blocked.json()).error).not.toMatch(/Too many requests|Unauthorized|Failed/);
  });
  it("does not send anything to someone who is already confirmed", async () => {
    sess.user = { id: "ann", email: EMAIL };
    await confirmEmail(makeVerifyToken("ann", EMAIL));
    expect(await (await resend()).json()).toEqual({ ok: true, already: true });
    expect(mail.sent).toHaveLength(0);
  });
  it("says so when the email could not be sent", async () => {
    sess.user = { id: "ann", email: EMAIL };
    mail.ok = false;
    expect((await resend()).status).toBe(502);
  });
});
