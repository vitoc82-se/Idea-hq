import { db } from "@/lib/db";
import type { Idea } from "../ideas/ideas-shared";

// Every idea the user owns, across all projects, shaped like the Ideas board's rows.
// Scoped by userId only, so another user's ideas never come back.
export async function loadFocusIdeas(userId: string): Promise<Idea[]> {
  const rows = await db.idea.findMany({
    where: { userId },
    include: { project: { select: { name: true, color: true } } },
  });
  return rows.map((r) => ({
    ...r,
    project: r.project ? { name: r.project.name, color: r.project.color } : null,
    aiEstimatedAt: r.aiEstimatedAt ? r.aiEstimatedAt.toISOString() : null,
    plannedAt: r.plannedAt ? r.plannedAt.toISOString() : null,
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
