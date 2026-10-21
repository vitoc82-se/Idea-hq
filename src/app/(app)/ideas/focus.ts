// The Focus view: the top ideas by value vs. effort across every project a user owns.
// Kept free of React and Prisma imports so the ranking can be tested on its own.
import { PRIORITY_WEIGHT, blockingIdeas, isEpic, valueEffortScore, type Idea } from "./ideas-shared";

const ACTIVE_STATUSES = ["new", "considering", "building"];

export interface FocusResult {
  top: Idea[];
  blockedCount: number; // candidates left out because a dependency hasn't shipped yet
}

export function rankFocusIdeas(ideas: Idea[], limit = 5): FocusResult {
  const byId = new Map(ideas.map((i) => [i.id, i]));
  let blockedCount = 0;

  const candidates = ideas.filter((idea) => {
    if (!ACTIVE_STATUSES.includes(idea.status)) return false;
    if (!idea.aiEstimatedAt || !idea.complexity || !idea.impact) return false;
    // Epics are containers; their stories are the work and show up on their own.
    if (isEpic(idea)) return false;
    if (blockingIdeas(idea, byId).length > 0) {
      blockedCount++;
      return false;
    }
    return true;
  });

  candidates.sort(
    (a, b) =>
      valueEffortScore(b) - valueEffortScore(a) ||
      (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.id.localeCompare(b.id)
  );

  return { top: candidates.slice(0, limit), blockedCount };
}

// Loads every idea the user owns, across all projects, in the shape rankFocusIdeas expects.
// `db` is passed in so tests can use the fake database.
export async function loadFocusIdeas(
  db: { idea: { findMany: (args: any) => Promise<any[]> } }, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string
): Promise<Idea[]> {
  const rows = await db.idea.findMany({
    where: { userId },
    include: {
      project: { select: { name: true, color: true, slug: true } },
      _count: { select: { children: true } },
    },
  });
  return rows.map((r) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    aiEstimatedAt: r.aiEstimatedAt ? new Date(r.aiEstimatedAt).toISOString() : null,
    plannedAt: r.plannedAt ? new Date(r.plannedAt).toISOString() : null,
    closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
  })) as Idea[];
}
