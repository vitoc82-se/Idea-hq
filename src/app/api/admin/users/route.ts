import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { dailyAiLimit } from "@/lib/access";
import { isPro, paywallOn } from "@/lib/billing";

// Owner-only: every account with its settings and usage, people waiting for
// approval first.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await db.user.findMany({
    orderBy: [{ approved: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: {
      id: true, name: true, email: true, approved: true, features: true, aiBuild: true, aiDailyLimit: true,
      aiCallsDay: true, aiCallsToday: true, createdAt: true, freeAccess: true, aiCredits: true, subStatus: true, subEndsAt: true,
    },
  });
  const [projects, ideas, runs] = await Promise.all([
    db.project.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.idea.groupBy({ by: ["userId"], _count: { _all: true } }),
    db.run.groupBy({ by: ["userId"], _count: { _all: true } }),
  ]);
  const count = (rows: { userId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.userId, r._count._all]));
  const pc = count(projects), ic = count(ideas), rc = count(runs);
  const today = new Date().toISOString().slice(0, 10); // usage is per UTC day
  // Same rule as isOwner, decided once: OWNER_EMAIL if set, else the first account.
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const firstId = ownerEmail ? null : (await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
  const out = [];
  for (const u of users) {
    out.push({
      id: u.id, name: u.name, email: u.email, approved: u.approved, features: u.features, aiBuild: u.aiBuild,
      aiDailyLimit: u.aiDailyLimit, freeAccess: u.freeAccess, aiCredits: u.aiCredits, pro: isPro(u), subStatus: u.subStatus, subEndsAt: u.subEndsAt, aiCallsToday: u.aiCallsDay === today ? u.aiCallsToday : 0, createdAt: u.createdAt,
      owner: ownerEmail ? u.email?.trim().toLowerCase() === ownerEmail : u.id === firstId, projects: pc.get(u.id) ?? 0, ideas: ic.get(u.id) ?? 0, runs: rc.get(u.id) ?? 0,
    });
  }
  return NextResponse.json({ users: out, defaultDailyLimit: dailyAiLimit(), usageDay: today, paywall: paywallOn() });
}
