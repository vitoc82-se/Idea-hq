import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canUse, consumeAiCall } from "@/lib/access";
import { GitHubError, GitHubRateLimitError } from "@/lib/github/client";
import { RunError } from "./engine";
import crypto from "crypto";

// Session + approval gate used by the run routes. Returns the user id or a
// ready 401 response.
export async function requireUser(): Promise<{ userId: string; email: string | null } | { res: NextResponse }> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId, email: session?.user?.email ?? null };
}

// Gate for routes that spend the server's AI key: needs the key configured and
// the user's daily allowance. Returns a ready response when blocked.
export async function requireAi(userId: string, email: string | null): Promise<NextResponse | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured (ANTHROPIC_API_KEY missing)." }, { status: 503 });
  }
  if (!(await consumeAiCall(userId, email))) {
    return NextResponse.json({ error: "Daily AI limit reached. Try again tomorrow." }, { status: 429 });
  }
  return null;
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof GitHubRateLimitError) {
    return NextResponse.json({ error: e.message, retryAfterSec: e.retryAfterSec }, { status: 429, headers: { "Retry-After": String(e.retryAfterSec) } });
  }
  if (e instanceof GitHubError) return NextResponse.json({ error: e.message }, { status: 502 });
  console.error("run route error", e);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

// ---- install-flow state: ties the GitHub redirect back to the signed-in user.
const secret = () => process.env.NEXTAUTH_SECRET || "";

export function signState(userId: string, now = Date.now()): string {
  const exp = now + 15 * 60 * 1000;
  const body = `${userId}.${exp}`;
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("hex");
  return Buffer.from(`${body}.${mac}`).toString("base64url");
}

export function verifyState(state: string | null, userId: string, now = Date.now()): boolean {
  if (!state || !secret()) return false;
  const raw = Buffer.from(state, "base64url").toString();
  const i = raw.lastIndexOf(".");
  if (i < 0) return false;
  const body = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const want = crypto.createHmac("sha256", secret()).update(body).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const [uid, exp] = body.split(".");
  return uid === userId && Number(exp) > now;
}
