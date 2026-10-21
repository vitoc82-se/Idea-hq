import { normalizeEmail } from "@/lib/support/sanitize";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner, ownerUserId } from "@/lib/owner";
import { dailyAiLimit } from "@/lib/access";
import { isPro, paywallOn } from "@/lib/billing";

// Owner-only: every account with its settings and usage, people waiting for
// approval first.
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const users = await db.user.findMany({
    orderBy: [{ approved: "asc" }, { createdAt: "asc" }],
    take: 500,
    select: {
      id: true, name: true, email: true, approved: true, features: true, aiBuild: true, aiDailyLimit: true,
      aiCallsDay: true, aiCallsToday: true, createdAt: true, freeAccess: true, aiCredits: true, subStatus: true, subEndsAt: true, proRevokedAt: true, lsSubscriptionId: true,
      emailVerified: true, accounts: { select: { provider: true } },
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
  // Same rule as isOwner, decided once: the oldest account holding OWNER_EMAIL, else the first account.
  const ownerId = await ownerUserId();
  // Accounts whose email looks like another account's (different letters, or padding): the sign-up
  // hole that let a lookalike become the owner. Shown so they can be removed.
  const seen = new Map<string, number>();
  for (const u of users) if (u.email) seen.set(u.email.trim().toLowerCase(), (seen.get(u.email.trim().toLowerCase()) ?? 0) + 1);
  const out = [];
  for (const u of users) {
    out.push({
      id: u.id, name: u.name, email: u.email, approved: u.approved, features: u.features, aiBuild: u.aiBuild,
      aiDailyLimit: u.aiDailyLimit, freeAccess: u.freeAccess, aiCredits: u.aiCredits, pro: isPro(u), proRevoked: !!u.proRevokedAt, lsSubscriptionId: u.lsSubscriptionId, subStatus: u.subStatus, subEndsAt: u.subEndsAt, aiCallsToday: u.aiCallsDay === today ? u.aiCallsToday : 0, createdAt: u.createdAt,
      owner: u.id === ownerId,
      emailVerified: u.emailVerified !== null || u.accounts.some((a) => a.provider === "google"),
      emailWarning: !u.email ? null : (seen.get(u.email.trim().toLowerCase()) ?? 0) > 1 ? "duplicate" : u.email !== u.email.trim() ? "padded" : !normalizeEmail(u.email) ? "invalid" : null, projects: pc.get(u.id) ?? 0, ideas: ic.get(u.id) ?? 0, runs: rc.get(u.id) ?? 0,
    });
  }
  // The exact build that is running (owner only; it is deliberately not in the public page code).
  const build = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null;
  return NextResponse.json({ users: out, defaultDailyLimit: dailyAiLimit(), usageDay: today, paywall: paywallOn(), build });
}
