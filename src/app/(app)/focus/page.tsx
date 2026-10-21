import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { ownerDisplayName } from "@/lib/owner";
import { Card } from "@/components/ui/card";
import { rankFocusIdeas } from "../ideas/focus";
import {
  COMPLEXITY_STYLES,
  IMPACT_STYLES,
  STATUS_STYLES,
  statusLabel,
} from "../ideas/ideas-shared";
import { loadFocusIdeas } from "./load-focus";

export const metadata = { title: "Focus" };

export const dynamic = "force-dynamic";

export default async function FocusPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!(await canUse(userId, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Focus</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Your account is waiting for approval. Ask {await ownerDisplayName()} to approve you.
        </p>
      </div>
    );
  }

  const { top, blockedCount } = rankFocusIdeas(await loadFocusIdeas(userId as string));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Focus</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Your top 5 by value vs. effort across all projects
        </p>
        {blockedCount > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {blockedCount} blocked {blockedCount === 1 ? "idea" : "ideas"} hidden
          </p>
        )}
      </div>

      {top.length === 0 ? (
        <Card className="p-6 text-sm text-gray-600 dark:text-gray-300">
          Nothing to focus on yet. Estimate or unblock ideas on the{" "}
          <Link href="/ideas" className="text-emerald-600 hover:underline dark:text-emerald-400">
            Ideas
          </Link>{" "}
          page.
        </Card>
      ) : (
        <ol className="space-y-3">
          {top.map((idea, i) => (
            <li key={idea.id}>
              <Card className="flex items-start gap-4 p-4">
                <span className="w-8 shrink-0 text-center text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/ideas/${idea.id}`}
                    className="font-medium text-gray-900 hover:text-emerald-600 hover:underline dark:text-white dark:hover:text-emerald-400"
                  >
                    {idea.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {idea.project && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: idea.project.color || "#94a3b8" }}
                        />
                        {idea.project.name}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 font-medium ${COMPLEXITY_STYLES[idea.complexity ?? ""] ?? ""}`}>
                      Effort {idea.complexity}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${IMPACT_STYLES[idea.impact ?? ""] ?? ""}`}>
                      Impact {idea.impact}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[idea.status] ?? ""}`}>
                      {statusLabel(idea.status)}
                    </span>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
