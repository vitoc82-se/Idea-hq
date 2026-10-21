import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { db } from "@/lib/db";
import { KnowledgeView } from "./knowledge-view";

export const metadata = { title: "Project knowledge" };

export const dynamic = "force-dynamic";

export default async function KnowledgePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return <p className="text-gray-500 dark:text-gray-400">Your account is waiting for approval.</p>;
  }
  const project = await db.project.findFirst({ where: { id: params.id, userId }, select: { id: true, name: true } });
  if (!project) {
    return (
      <div className="space-y-2">
        <Link href="/projects" className="text-sm text-emerald-600 hover:underline">← Back to projects</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Project not found</h1>
      </div>
    );
  }
  return <KnowledgeView projectId={project.id} projectName={project.name} />;
}
