import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { db } from "@/lib/db";
import { IdeaDetail } from "../ideas-detail";
import type { Idea, IdeaRef } from "../ideas-shared";

export const dynamic = "force-dynamic";

export default async function IdeaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!(await isOwner(userId, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ideas</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          This backlog is private to the app owner.
        </p>
      </div>
    );
  }

  const record = await db.idea.findFirst({
    where: { id: params.id, userId },
    include: { project: { select: { name: true, color: true } } },
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
    aiEstimatedAt: record.aiEstimatedAt ? record.aiEstimatedAt.toISOString() : null,
    plan: record.plan,
    plannedAt: record.plannedAt ? record.plannedAt.toISOString() : null,
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

  return <IdeaDetail initial={idea} allIdeas={allIdeas} blocks={blocksRefs} />;
}
