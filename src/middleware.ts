import { NextResponse, type NextRequest } from "next/server";
import { CAPS } from "@/lib/caps-values";

// One place that refuses an oversized request before any route reads it. Individual fields have their own limits
// (src/lib/caps.ts); this stops a huge body from being parsed at all. Webhooks are left alone: GitHub and Lemon
// Squeezy decide how big their messages are, and they are checked by signature.
const LARGE = /^\/api\/projects\/[^/]+\/import\/preview$/; // pasted backlog lists
const SKIP = /^\/api\/(github\/webhook|billing\/lemonsqueezy\/webhook)\/?$/;

export function middleware(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (SKIP.test(path)) return NextResponse.next();
  const length = Number(req.headers.get("content-length"));
  const max = LARGE.test(path) ? CAPS.bodyBytesLarge : CAPS.bodyBytes;
  if (Number.isFinite(length) && length > max) {
    return NextResponse.json({ error: "That is too much to send in one go. Shorten it and try again." }, { status: 413 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
