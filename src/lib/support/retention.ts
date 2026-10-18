import { db } from "@/lib/db";

// Daily clean-up: closed tickets older than each project's retention window are
// deleted with their messages, and expired rate-limit rows are pruned.
export async function runRetention(now = new Date()): Promise<{ spaces: number; tickets: number; buckets: number }> {
  const spaces = await db.supportSpace.findMany({ select: { projectId: true, retentionDays: true } });
  let tickets = 0;
  for (const s of spaces) {
    const cutoff = new Date(now.getTime() - s.retentionDays * 86_400_000);
    const res = await db.ticket.deleteMany({
      where: { projectId: s.projectId, status: { in: ["resolved", "closed"] }, closedAt: { lt: cutoff } },
    });
    tickets += res.count;
  }
  const buckets = await db.rateBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 2 * 86_400_000) } } });
  return { spaces: spaces.length, tickets, buckets: buckets.count };
}
