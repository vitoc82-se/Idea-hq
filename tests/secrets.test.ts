import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// One master secret signing everything meant that rotating it broke every customer's ticket link as well as every
// session. Each purpose can now have its own secret; with none set, everything works exactly as it did.
import { secretFor, SECRET_ENV, type Purpose } from "@/lib/secrets";
import { deriveTicketToken, hashIdent, signBlob, verifyBlob } from "@/lib/support/tokens";
import { makeVerifyToken, readVerifyToken } from "@/lib/email-verification";
import { signState, verifyState } from "@/lib/runs/http";

const MASTER = "master-master-master-master-master-1";
const OTHER = "rotated-rotated-rotated-rotated-0001";
const PINNED = "pinned-pinned-pinned-pinned-pinned-1";
const hmac = (secret: string, text: string, enc: "base64url" | "hex") => crypto.createHmac("sha256", secret).update(text).digest(enc);

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["NEXTAUTH_SECRET", ...Object.values(SECRET_ENV)]) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.NEXTAUTH_SECRET = MASTER;
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("with no per-purpose secret, nothing changes", () => {
  it("every purpose uses NEXTAUTH_SECRET", () => {
    for (const p of Object.keys(SECRET_ENV) as Purpose[]) expect(secretFor(p), p).toBe(MASTER);
  });
  it("tokens and hashes are exactly what they were before (existing links keep working)", () => {
    expect(deriveTicketToken("tk_abc")).toBe(hmac(MASTER, "ticket:tk_abc", "base64url"));
    expect(hashIdent("1.2.3.4")).toBe(hmac(MASTER, "ident:1.2.3.4", "hex").slice(0, 32));
    const blob = signBlob({ a: 1 }, 60_000, 1000);
    const [body, mac] = [blob.slice(0, blob.lastIndexOf(".")), blob.slice(blob.lastIndexOf(".") + 1)];
    expect(mac).toBe(hmac(MASTER, "blob:" + body, "base64url"));
    expect(verifyBlob(blob, 2000)).toMatchObject({ a: 1 });
    const t = makeVerifyToken("u1", "A@x.se");
    expect(t.split(".")[1]).toBe(hmac(MASTER, "verify-email:" + t.split(".")[0], "base64url"));
    expect(readVerifyToken(t)).toEqual({ userId: "u1", email: "a@x.se" });
  });
  it("a missing master is an error, never an empty key", () => {
    delete process.env.NEXTAUTH_SECRET;
    for (const p of Object.keys(SECRET_ENV) as Purpose[]) expect(() => secretFor(p), p).toThrow(/NEXTAUTH_SECRET is not set/);
    expect(() => signState("u1")).toThrow();
    expect(() => deriveTicketToken("x")).toThrow();
  });
});

describe("a purpose with its own secret is independent", () => {
  it("rotating NEXTAUTH_SECRET leaves a pinned purpose untouched and only breaks the others", () => {
    process.env.TICKET_TOKEN_SECRET = PINNED;
    const ticket = deriveTicketToken("tk_abc");
    const email = makeVerifyToken("u1", "a@x.se");
    expect(ticket).toBe(hmac(PINNED, "ticket:tk_abc", "base64url"));
    process.env.NEXTAUTH_SECRET = OTHER; // the "rotation"
    expect(deriveTicketToken("tk_abc")).toBe(ticket); // customers' links still work
    expect(readVerifyToken(email)).toBeNull(); // a confirm-your-email link made before the rotation does not
  });
  it("the same secret value pinned to a purpose reproduces the old results (the safe way to start)", () => {
    const before = deriveTicketToken("tk_abc");
    process.env.TICKET_TOKEN_SECRET = MASTER;
    expect(deriveTicketToken("tk_abc")).toBe(before);
  });
  it("purposes do not share keys: a token made for one is not accepted by another", () => {
    process.env.EMAIL_LINK_SECRET = PINNED;
    const t = makeVerifyToken("u1", "a@x.se");
    expect(readVerifyToken(t)).toEqual({ userId: "u1", email: "a@x.se" });
    process.env.EMAIL_LINK_SECRET = OTHER;
    expect(readVerifyToken(t)).toBeNull();
    delete process.env.EMAIL_LINK_SECRET;
    expect(readVerifyToken(t)).toBeNull();
    process.env.RATE_LIMIT_SECRET = PINNED;
    expect(hashIdent("x")).not.toBe(hmac(MASTER, "ident:x", "hex").slice(0, 32));
  });
  it("each purpose reads its own variable", () => {
    for (const [p, name] of Object.entries(SECRET_ENV)) {
      process.env[name] = `${p}`.padEnd(40, "x");
      expect(secretFor(p as Purpose)).toBe(`${p}`.padEnd(40, "x"));
      delete process.env[name];
    }
  });
});

describe("a secret that is set must be a real one", () => {
  it("too short is an error, not a silent fall back", () => {
    process.env.TICKET_TOKEN_SECRET = "short";
    expect(() => secretFor("ticket")).toThrow(/at least 32 characters/);
    expect(() => deriveTicketToken("x")).toThrow();
    expect(secretFor("blob")).toBe(MASTER); // the others are unaffected
  });
  it("an empty value counts as not set", () => {
    process.env.TICKET_TOKEN_SECRET = "";
    expect(secretFor("ticket")).toBe(MASTER);
  });
});

describe("the GitHub connect state", () => {
  it("works, expires, belongs to one person, and is not valid for a plain MAC of the same text", () => {
    const state = signState("u1", 1000);
    expect(verifyState(state, "u1", 2000)).toBe(true);
    expect(verifyState(state, "u2", 2000)).toBe(false);
    expect(verifyState(state, "u1", 1000 + 16 * 60 * 1000)).toBe(false);
    const raw = Buffer.from(state, "base64url").toString();
    const body = raw.slice(0, raw.lastIndexOf("."));
    const unlabelled = Buffer.from(`${body}.${hmac(MASTER, body, "hex")}`).toString("base64url");
    expect(verifyState(unlabelled, "u1", 2000)).toBe(false);
    expect(verifyState(null, "u1")).toBe(false);
    expect(verifyState("not-base64-state", "u1")).toBe(false);
    process.env.OAUTH_STATE_SECRET = PINNED;
    expect(verifyState(state, "u1", 2000)).toBe(false);
  });
});
