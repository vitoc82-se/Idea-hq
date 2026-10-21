import crypto from "crypto";
import { PUBLIC_KEY_RE, TOKEN_RE } from "./constants";

import { secretFor } from "../secrets";

// Customer ticket link token: derived from the ticket id with a server secret, so
// it is unguessable (256 bits) yet can be rebuilt for later emails. Only its
// sha256 is stored; the plain token exists in the customer's emails and URL.
export function deriveTicketToken(ticketId: string): string {
  return crypto.createHmac("sha256", secretFor("ticket")).update("ticket:" + ticketId).digest("base64url");
}

export function newTicketId(): string {
  return "tk_" + crypto.randomBytes(12).toString("base64url");
}

export function isTokenShape(t: unknown): t is string {
  return typeof t === "string" && TOKEN_RE.test(t);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function newPublicKey(): string {
  return "ihq_" + crypto.randomBytes(12).toString("base64url");
}

export function isKeyShape(k: unknown): k is string {
  return typeof k === "string" && PUBLIC_KEY_RE.test(k);
}

// Hash of anything identifying (IP, email) for rate-limit keys, so the bucket
// table never holds the raw value.
export function hashIdent(value: string): string {
  return crypto.createHmac("sha256", secretFor("ident")).update("ident:" + value).digest("hex").slice(0, 32);
}

// Signed, expiring blob. Carries an AI answer from the "ask" step to the ticket
// form so the client cannot invent an AI answer of its own.
export function signBlob(payload: Record<string, unknown>, ttlMs = 60 * 60 * 1000, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString("base64url");
  const mac = crypto.createHmac("sha256", secretFor("blob")).update("blob:" + body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyBlob<T extends Record<string, unknown>>(blob: unknown, now = Date.now()): T | null {
  if (typeof blob !== "string" || blob.length > 8000) return null;
  const i = blob.lastIndexOf(".");
  if (i < 1) return null;
  const body = blob.slice(0, i);
  const mac = blob.slice(i + 1);
  const want = crypto.createHmac("sha256", secretFor("blob")).update("blob:" + body).digest("base64url");
  if (!safeEqualHex(mac, want)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Constant-time check of a bearer secret (cron).
export function bearerMatches(header: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || !header) return false;
  return safeEqualHex(header, `Bearer ${expected}`);
}
