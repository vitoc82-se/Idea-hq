import { db } from "@/lib/db";
import { reconcileRun, STUCK_AFTER_MS } from "./engine";

// A run is only checked against GitHub when someone opens its idea. One nobody opens stays "dispatched" or "running"
// for ever, with the owner waiting. The daily check (api/cron/stuck-runs) goes through those: reconcileRun asks GitHub
// what happened to the workflow and handles the answer (a finished build opens its pull request, a failed one fails with
// the step that broke), and fails what GitHub has reported nothing about for too long. A run it fails emails its owner.
const MAX_PER_CHECK = 100;

export async function findStuckRuns(now: Date): Promise<{ id: string }[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  return db.run.findMany({
    where: {
      status: { in: ["dispatched", "running"] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_CHECK,
    select: { id: true },
  });
}

export type StuckReport = { checked: number; recovered: number; failed: number; unchanged: number; errors: number };

// `reconcile` is injectable so a test needs no GitHub.
export async function checkStuckRuns(now: Date = new Date(), reconcile: (id: string) => Promise<void> = (id) => reconcileRun(id)): Promise<StuckReport> {
  const runs = await findStuckRuns(now);
  const report: StuckReport = { checked: runs.length, recovered: 0, failed: 0, unchanged: 0, errors: 0 };
  for (const { id } of runs) {
    try {
      await reconcile(id);
    } catch {
      report.errors++; // one run that cannot be reached must not stop the others
      continue;
    }
    const after = await db.run.findUnique({ where: { id }, select: { status: true } });
    if (after?.status === "pr_open" || after?.status === "merged") report.recovered++;
    else if (after?.status === "failed" || after?.status === "closed" || after?.status === "cancelled") report.failed++;
    else report.unchanged++;
  }
  return report;
}
