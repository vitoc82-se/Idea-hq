import { NextResponse } from "next/server";

// Small helpers shared by the public support routes.

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra },
  });
}

export async function readJson(request: Request, maxBytes = 32_000): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Browsers always send Origin on cross-site POSTs. If it is present it must be
// this site: the widget and ticket page post to their own origin.
export function sameOriginOk(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function publicOrigin(request: Request): string {
  return (process.env.SUPPORT_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}
