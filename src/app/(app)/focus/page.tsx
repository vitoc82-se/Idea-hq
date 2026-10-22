import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canUse } from "@/lib/access";
import { db } from "@/lib/db";
import { ownerDisplayName } from "@/lib/owner";
import { Card } from "@/components/ui/card";
import {
  COMPLEXITY_STYLES,
  IMPACT_STYLES,
  STATUS_STYLES,
  statusLabel,
} from "../ideas/ideas-shared";
import { loadFocusIdeas, rankFocusIdeas } from "../ideas/focus";
import { sizeExpectation, sizeName } from "@/lib/runs/sizes";

export const metadata = { title: "Focus" };

export const dynamic = "force-dynamic";

export default async function FocusPage() {
  const session = await getServerSession(authOptions);

  if (!(await canUse(session?.user?.id, session?.user?.email))) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Focus</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Your account is waiting for approval. Ask {await ownerDisplayName()} to approve you.
        </p>
      </div>
    );
  }

  const userId = session?.user?.id ?? "";
  const { top, blockedCount } = rankFocusIdeas(await loadFocusIdeas(db, userId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Focus</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Your top 5 by value vs. effort across all projects
        </p>
      </div>

      {top.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-700 dark:text-gray-300">
            Nothing to focus on yet. Estimate ideas or unblock the ones waiting on other work.
          </p>
          <Link href="/ideas" className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            Go to Ideas
          </Link>
        </Card>
      ) : (
        <ol className="space-y-3">
          {top.map((idea, i) => (
            <li key={idea.id}>
              <Card className="flex items-start gap-4 p-4">
                <span className="text-2xl font-bold text-gray-300 dark:text-gray-600 w-8 shrink-0 text-center">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/ideas/${idea.id}`} className="font-medium text-gray-900 hover:text-emerald-700 dark:text-white dark:hover:text-emerald-400">
                    {idea.title}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {idea.project && (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        title="Project"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: idea.project.color || "#94a3b8" }}
                        />
                        {idea.project.name}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${COMPLEXITY_STYLES[idea.complexity!] ?? ""}`} title={`Effort: ${sizeExpectation(idea.complexity)}`}>
                      Effort {sizeName(idea.complexity)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${IMPACT_STYLES[idea.impact!] ?? ""}`} title="Value">
                      Value {idea.impact}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[idea.status] ?? ""}`}>
                      {statusLabel(idea.status)}
                    </span>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {blockedCount > 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {blockedCount} blocked {blockedCount === 1 ? "idea" : "ideas"} hidden until the work they depend on is done.
        </p>
      )}
    </div>
  );
}
