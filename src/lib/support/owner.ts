import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isOwner } from "@/lib/owner";
import { requireUser } from "@/lib/runs/http";
import { TICKETS_FEATURE } from "./constants";

// Owner-side gate for every ticket route: a signed-in, approved account that
// holds the "tickets" feature (the owner of Idea HQ always does).
export async function requireTickets(): Promise<{ userId: string; email: string | null } | { res: NextResponse }> {
  const auth = await requireUser();
  if ("res" in auth) return auth;
  if (await isOwner(auth.userId, auth.email)) return auth;
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { features: true } });
  if (!user?.features?.includes(TICKETS_FEATURE)) {
    return { res: NextResponse.json({ error: "Support tickets are not enabled for your account." }, { status: 403 }) };
  }
  return auth;
}

export async function hasTickets(userId: string, email: string | null): Promise<boolean> {
  if (await isOwner(userId, email)) return true;
  const user = await db.user.findUnique({ where: { id: userId }, select: { features: true } });
  return !!user?.features?.includes(TICKETS_FEATURE);
}
