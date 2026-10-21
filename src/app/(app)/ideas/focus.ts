// The Focus view: the top ideas across every project, ranked by value vs. effort.
// Pure on purpose (no React, no Prisma) so it is easy to test.

import { blockingIdeas, PRIORITY_WEIGHT, valueEffortScore, type Idea } from "./ideas-shared";

// Only ideas that are still open can take a focus slot. Done and parked are out.
const OPEN_STATUSES = ["new", "considering", "building"];

// `ideas` is the user's full idea list (all projects). Blocking is resolved
// against that whole list, so a dependency in another project still counts.
// `blockedCount` is how many otherwise-eligible ideas were hidden for being blocked.
export function rankFocusIdeas(ideas: Idea[], limit = 5): { top: Idea[]; blockedCount: number } {
  const byId = new Map(ideas.map((i) => [i.id, i]));

  // Unestimated ideas are left out: there is no score to rank them by.
  const eligible = ideas.filter(
    (i) => OPEN_STATUSES.includes(i.status) && i.aiEstimatedAt && i.complexity && i.impact,
  );
  const ready = eligible.filter((i) => blockingIdeas(i, byId).length === 0);

  const top = [...ready]
    .sort(
      (a, b) =>
        valueEffortScore(b) - valueEffortScore(a) ||
        (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);

  return { top, blockedCount: eligible.length - ready.length };
}
