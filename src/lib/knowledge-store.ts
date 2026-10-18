import { db } from "@/lib/db";
import { assembleContext, knowledgeFor, type Knowledge } from "./knowledge";

// Reads and writes a project's knowledge, keeping `Project.context` (the text the
// AI reads) in step with it. Always scoped to the owner.

export async function loadKnowledge(userId: string, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!project) return null;
  const memory = await db.projectMemory.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" }, take: 200 });
  return { project, knowledge: knowledgeFor(project.knowledge, project.context), memory };
}

// Re-assemble the AI-facing context from sections and memory. Only bumps
// contextUpdatedAt when the text really changed, because that timestamp marks
// every existing estimate for the project as stale.
export async function saveKnowledge(userId: string, projectId: string, knowledge: Knowledge, extra: Record<string, unknown> = {}) {
  const project = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!project) return null;
  const memory = await db.projectMemory.findMany({ where: { projectId, userId }, orderBy: { createdAt: "desc" }, take: 200 });
  const context = assembleContext(knowledge, memory);
  const changed = context !== (project.context || "");
  return db.project.update({
    where: { id: projectId },
    data: { knowledge: knowledge as unknown as object, context, ...(changed ? { contextUpdatedAt: new Date() } : {}), ...extra },
  });
}

// Add a memory entry (and refresh the assembled context).
export async function addMemory(userId: string, projectId: string, entry: { kind: string; text: string; pinned?: boolean; source?: string; runId?: string }) {
  const text = entry.text.trim().slice(0, 600);
  if (!text) return null;
  if (entry.runId) {
    const dup = await db.projectMemory.findFirst({ where: { projectId, userId, runId: entry.runId, kind: entry.kind } });
    if (dup) return dup;
  }
  const row = await db.projectMemory.create({
    data: { projectId, userId, kind: entry.kind, text, pinned: !!entry.pinned, source: entry.source || "auto", runId: entry.runId ?? null },
  });
  const loaded = await loadKnowledge(userId, projectId);
  if (loaded) await saveKnowledge(userId, projectId, loaded.knowledge);
  return row;
}
