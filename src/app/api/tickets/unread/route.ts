import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/runs/http";
import { hasTickets } from "@/lib/support/owner";

// Owner: drives the sidebar item. `enabled` is false when the account lacks the feature.
export async function GET() {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  if (!(await hasTickets(auth.userId, auth.email))) return NextResponse.json({ enabled: false, unread: 0 });
  const unread = await db.ticket.count({ where: { project: { userId: auth.userId }, unread: true, status: { in: ["open", "pending"] } } });
  return NextResponse.json({ enabled: true, unread });
}
