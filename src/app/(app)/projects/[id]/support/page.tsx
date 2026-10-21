import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { db } from "@/lib/db";
import { hasTickets } from "@/lib/support/owner";
import { SupportSettings } from "./support-settings";

export const metadata = { title: "Support settings" };

export const dynamic = "force-dynamic";

export default async function ProjectSupportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return <p className="text-gray-500 dark:text-gray-400">Your account is waiting for approval.</p>;
  }
  if (!(await hasTickets(userId, session?.user?.email ?? null))) {
    return <p className="text-gray-600 dark:text-gray-400">Support tickets are not switched on for your account yet.</p>;
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
  return <SupportSettings projectId={project.id} projectName={project.name} />;
}
