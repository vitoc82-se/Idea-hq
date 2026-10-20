import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { db } from "@/lib/db";
import { BacklogImport } from "@/components/backlog-import";

export const metadata = { title: "Import ideas" };

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return <p className="text-gray-500 dark:text-gray-400">Your account is waiting for approval.</p>;
  }
  const project = await db.project.findFirst({ where: { id: params.id, userId }, select: { id: true, name: true } });
  if (!project) {
    return (
      <div className="space-y-2">
        <Link href="/projects" className="text-sm text-emerald-700 hover:underline">← Back to projects</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Project not found</h1>
      </div>
    );
  }
  return (
    <div className="max-w-2xl space-y-3">
      <Link href="/projects" className="text-sm text-emerald-700 hover:underline">← Back to projects</Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import ideas into {project.name}</h1>
      <p className="text-sm text-gray-700 dark:text-gray-300">Already have a TODO.md or a list somewhere? Bring it in. You choose what to import before anything is saved.</p>
      <BacklogImport projectId={project.id} />
      <Link href="/ideas" className="inline-block text-sm text-emerald-700 underline">Go to my ideas</Link>
    </div>
  );
}
