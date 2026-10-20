import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/support/tokens";
import { runRetention } from "@/lib/support/retention";

// Vercel Cron (daily). Not a session route: it is authorised by CRON_SECRET,
// which Vercel sends as a bearer token. Deletes old closed tickets and old
// rate-limit rows.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const result = await runRetention();
  return NextResponse.json({ ok: true, ...result });
}
