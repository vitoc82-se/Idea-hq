import { db } from "@/lib/db";
import type { GhJob } from "@/lib/github/client";
import { stageOf } from "./progress";
import { summarizeHistory, type SizeHistory, type StageMs } from "./history";

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

// Sums the time of each stage's steps and the span of the whole workflow. Null when GitHub reported no usable times.
export function stageDurations(jobs: GhJob[] | null | undefined): StageMs | null {
  const out: Record<string, number> = {};
  let first = Infinity;
  let last = -Infinity;
  for (const job of jobs ?? []) {
    for (const s of job.steps) {
      const a = ms(s.startedAt);
      const b = ms(s.completedAt);
      if (!(b >= a)) continue;
      first = Math.min(first, a);
      last = Math.max(last, b);
      const id = stageOf(job.name, s.name);
      if (id && id !== "pr") out[id] = (out[id] ?? 0) + (b - a);
    }
  }
  if (!Object.keys(out).length) return null;
  return { ...out, total: last - first };
}

// The runs that finished and opened a pull request say what a size really takes; failed and closed ones do not.
export async function loadHistory(userId: string): Promise<SizeHistory> {
  const rows = await db.run.findMany({
    where: { userId, kind: "implement", status: { in: ["pr_open", "merged"] }, turns: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { turns: true, costUsd: true, sizeAtRun: true, stageMs: true, idea: { select: { complexity: true } } },
  });
  return summarizeHistory(rows.map((r) => ({ turns: r.turns, costUsd: r.costUsd, size: r.sizeAtRun ?? r.idea?.complexity ?? null, stageMs: r.stageMs })));
}
