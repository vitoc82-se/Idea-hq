import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/support/tokens";
import { checkStuckRuns } from "@/lib/runs/stuck";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

// Vercel Cron (daily). Not a session route: it is authorised by CRON_SECRET, which Vercel sends as a bearer token.
// Goes through the runs that have been going for more than 45 minutes with nobody looking (see lib/runs/stuck.ts) and
// answers with how many it checked, recovered and failed, so the log says what it did.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const report = await checkStuckRuns();
  // Only when it found something, and through the app's own logger (fixed text and counts, never a message).
  if (report.checked > 0) logError("stuck runs handled", undefined, `checked=${report.checked}`, `recovered=${report.recovered}`, `failed=${report.failed}`, `unchanged=${report.unchanged}`, `errors=${report.errors}`);
  return NextResponse.json({ ok: true, ...report });
}
