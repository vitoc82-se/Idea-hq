import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { ownerDisplayName } from "@/lib/owner";
import { db } from "@/lib/db";
import { IdeaDetail } from "../ideas-detail";
import type { Idea, IdeaRef, StoryChild } from "../ideas-shared";
import { knowledgeFor, knowledgeNotice, pendingProposals } from "@/lib/knowledge";

// What the idea page says about how current the project knowledge is (only when there is something to do).
function knowledgeNoticeFor(project: { knowledgeBehind: number | null; knowledge: unknown; context: string | null } | null, projectId: string) {
  if (!project) return null;
  const k = knowledgeFor(project.knowledge ?? null, project.context);
  const n = knowledgeNotice({ proposals: pendingProposals(k).length, behind: project.knowledgeBehind, learnedAt: k.learnedAt });
  return n.level === "ok" ? null : { level: n.level, text: n.text, projectId };
}

export const metadata = { title: "Idea" };

export const dynamic = "force-dynamic";

export default async function IdeaDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!(await canUse(userId, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ideas</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Your account is waiting for approval. Ask {await ownerDisplayName()} to approve you.
        </p>
      </div>
    );
  }

  const record = await db.idea.findFirst({
    where: { id: params.id, userId },
    include: { project: { select: { name: true, color: true, knowledgeBehind: true, knowledge: true, context: true } } },
  });

  if (!record) {
    return (
      <div className="max-w-md space-y-3">
        <Link
          href="/ideas"
          className="text-sm text-emerald-600 hover:underline"
        >
          ← Back to ideas
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Idea not found
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          It may have been deleted.
        </p>
      </div>
    );
  }

  // Serialize dates for the client component.
  const idea: Idea = {
    id: record.id,
    projectId: record.projectId,
    parentId: record.parentId,
    project: record.project
      ? { name: record.project.name, color: record.project.color }
      : null,
    title: record.title,
    notes: record.notes,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    blockedBy: record.blockedBy,
    complexity: record.complexity,
    impact: record.impact,
    scope: record.scope,
    scopeEditedAt: record.scopeEditedAt ? record.scopeEditedAt.toISOString() : null,
    aiEstimatedAt: record.aiEstimatedAt ? record.aiEstimatedAt.toISOString() : null,
    plan: record.plan,
    plannedAt: record.plannedAt ? record.plannedAt.toISOString() : null,
    planEditedAt: record.planEditedAt ? record.planEditedAt.toISOString() : null,
    corrections: record.corrections,
    ownerSteps: record.ownerSteps ?? null,
    closureNote: record.closureNote,
    closedAt: record.closedAt ? record.closedAt.toISOString() : null,
    kind: record.kind,
    severity: record.severity,
    repro: record.repro,
    createdAt: record.createdAt.toISOString(),
  };

  // Other ideas in the SAME project — for the dependency picker (dependencies
  // are within a project, not across products).
  const others = await db.idea.findMany({
    where: { userId, projectId: record.projectId, id: { not: record.id } },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const allIdeas: IdeaRef[] = others.map((o) => ({
    id: o.id,
    title: o.title,
    status: o.status,
  }));

  // Ideas that this one blocks (reverse of blockedBy).
  const blocks = await db.idea.findMany({
    where: { userId, blockedBy: { has: record.id } },
    select: { id: true, title: true, status: true },
  });
  const blocksRefs: IdeaRef[] = blocks.map((o) => ({
    id: o.id,
    title: o.title,
    status: o.status,
  }));

  // Child stories (if this idea is an epic), in build order.
  const childRows = await db.idea.findMany({
    where: { parentId: record.id, userId },
    select: { id: true, title: true, status: true, complexity: true, impact: true },
    orderBy: { createdAt: "asc" },
  });
  const children: StoryChild[] = childRows.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    complexity: c.complexity,
    impact: c.impact,
  }));

  // Parent epic (if this idea is itself a story).
  let parent: IdeaRef | null = null;
  if (record.parentId) {
    const p = await db.idea.findFirst({
      where: { id: record.parentId, userId },
      select: { id: true, title: true, status: true },
    });
    if (p) parent = { id: p.id, title: p.title, status: p.status };
  }

  return (
    <IdeaDetail
      initial={idea}
      allIdeas={allIdeas}
      blocks={blocksRefs}
      childStories={children}
      parent={parent}
      knowledgeNotice={knowledgeNoticeFor(record.project, record.projectId)}
    />
  );
}
