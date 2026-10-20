import { db } from "./db";

// What AI runs cost, per project and calendar month (UTC), and the optional cap the
// person set. Cost is whatever the run reported when it finished (Claude runs report it;
// OpenAI runs do not, and show up as "cost not reported"). The cap is checked when a
// run is started, approved or revised, so a run already underway can finish slightly over.

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const COUNTED = { kind: { in: ["implement", "learn"] } };
const FINISHED = ["pr_open", "merged", "closed", "failed"];

export type Spend = { monthUsd: number; runs: number; unpriced: number };

export async function spendByProject(userId: string, now: Date = new Date()): Promise<Map<string, Spend>> {
  const since = monthStart(now);
  const [sums, unpriced] = await Promise.all([
    db.run.groupBy({ by: ["projectId"], where: { userId, createdAt: { gte: since }, ...COUNTED }, _sum: { costUsd: true }, _count: { _all: true } }),
    db.run.groupBy({ by: ["projectId"], where: { userId, createdAt: { gte: since }, ...COUNTED, costUsd: null, status: { in: FINISHED } }, _count: { _all: true } }),
  ]);
  const out = new Map<string, Spend>();
  for (const r of sums) out.set(r.projectId, { monthUsd: round2(r._sum.costUsd ?? 0), runs: r._count._all, unpriced: 0 });
  for (const r of unpriced) {
    const s = out.get(r.projectId);
    if (s) s.unpriced = r._count._all;
  }
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CapState = { capUsd: number | null; monthUsd: number; reached: boolean };

export async function capState(projectId: string, now: Date = new Date()): Promise<CapState> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { userId: true, monthlyCapUsd: true } });
  if (!p) return { capUsd: null, monthUsd: 0, reached: false };
  if (p.monthlyCapUsd == null) return { capUsd: null, monthUsd: 0, reached: false };
  const agg = await db.run.aggregate({ where: { projectId, userId: p.userId, createdAt: { gte: monthStart(now) }, ...COUNTED }, _sum: { costUsd: true } });
  const monthUsd = round2(agg._sum.costUsd ?? 0);
  return { capUsd: p.monthlyCapUsd, monthUsd, reached: monthUsd >= p.monthlyCapUsd };
}

export function capMessage(name: string, s: CapState): string {
  return `The monthly spending cap for ${name} is reached: $${s.monthUsd.toFixed(2)} of $${(s.capUsd ?? 0).toFixed(2)} this month. Raise the cap in Projects to keep going, or wait for next month.`;
}

export const CAP_MIN = 0.5;
export const CAP_MAX = 100000;

// null clears the cap; anything else must be a sensible dollar amount.
export function cleanCap(v: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === null || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < CAP_MIN || n > CAP_MAX) return { ok: false, error: `The monthly cap must be between $${CAP_MIN} and $${CAP_MAX}, or empty for no cap.` };
  return { ok: true, value: round2(n) };
}
