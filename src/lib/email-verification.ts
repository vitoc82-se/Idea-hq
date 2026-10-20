import crypto from "crypto";
import { db } from "./db";
import { baseUrl, sendEmail } from "./support/email";

// Proving that a person owns the address they signed up with. Without it, anyone can register
// "friend@gmail.com" before the real friend does, and get approved when the owner approves
// "their" address.
//
// The link is stateless: a signed, expiring token tied to the account AND the exact address, so
// there is nothing to store and a changed address invalidates it. Opening the link only shows a
// button; the confirmation itself is a POST, so mail scanners that fetch links cannot confirm
// an address for the person who registered it.

const TTL_MS = 3 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

const mac = (body: string) => crypto.createHmac("sha256", secret()).update("verify-email:" + body).digest("base64url");

export function makeVerifyToken(userId: string, email: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, e: email.trim().toLowerCase(), x: now + TTL_MS })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readVerifyToken(token: unknown, now = Date.now()): { userId: string; email: string } | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const body = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(mac(body));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { u?: unknown; e?: unknown; x?: unknown };
    if (typeof p.u !== "string" || typeof p.e !== "string" || typeof p.x !== "number" || p.x < now) return null;
    return { userId: p.u, email: p.e };
  } catch {
    return null;
  }
}

// A person counts as verified when they confirmed the address, or signed in with Google (which has
// already proven the address).
export async function isVerified(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { emailVerified: true, accounts: { select: { provider: true } } } });
  return !!u && (u.emailVerified !== null || u.accounts.some((a) => a.provider === "google"));
}

export function verifyLink(userId: string, email: string): string {
  return `${baseUrl()}/auth/verify?token=${encodeURIComponent(makeVerifyToken(userId, email))}`;
}

export async function sendVerificationEmail(user: { id: string; email: string | null; name?: string | null }): Promise<boolean> {
  if (!user.email) return false;
  return sendEmail({
    to: user.email,
    fromName: "Idea HQ",
    subject: "Confirm your email for Idea HQ",
    text: [
      `Hi${user.name ? " " + user.name.split(" ")[0] : ""},`,
      "",
      "Confirm that this is your email address, so the owner can approve your Idea HQ account:",
      verifyLink(user.id, user.email),
      "",
      "The link works for three days. If you did not create an account, ignore this email.",
    ].join("\n"),
  });
}

export async function confirmEmail(token: unknown): Promise<"ok" | "invalid"> {
  const t = readVerifyToken(token);
  if (!t) return "invalid";
  const u = await db.user.findUnique({ where: { id: t.userId }, select: { id: true, email: true, emailVerified: true } });
  // The token is for one exact address: it must still be the account's address.
  if (!u || !u.email || u.email.trim().toLowerCase() !== t.email) return "invalid";
  if (u.emailVerified === null) await db.user.update({ where: { id: u.id }, data: { emailVerified: new Date() } });
  return "ok";
}
