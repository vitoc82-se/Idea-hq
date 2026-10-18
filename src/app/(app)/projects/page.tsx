import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { hasTickets } from "@/lib/support/owner";
import { ProjectsAdmin } from "./projects-admin";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getServerSession(authOptions);

  if (!(await canUse(session?.user?.id, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          This workspace is private to the app owner.
        </p>
      </div>
    );
  }

  const supportEnabled = await hasTickets(session?.user?.id as string, session?.user?.email ?? null);
  return <ProjectsAdmin supportEnabled={supportEnabled} />;
}
