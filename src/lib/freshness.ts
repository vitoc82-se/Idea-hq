import { repoAccessProblem } from "@/lib/github/access";
import { db } from "./db";
import { github as realGithub, type GitHubApi } from "./github/client";
import { knowledgeFor } from "./knowledge";
import { workflowVersion, WORKFLOW_VERSION, requiredWorkflowVersion } from "./runs/workflow";
import { WORKFLOW_PATH } from "./runs/state";

// Is what Idea HQ knows about a project still current? Two quiet checks, cached so the
// Projects page never hammers GitHub:
//  - the AI's project knowledge versus the repo (how many commits since it was learned)
//  - the installed workflow versus the newest one (an optional update)

// Past this many new commits the person is asked whether to scan the project again.
export const STALE_COMMITS = 20;
export const FRESHNESS_TTL_MS = 60 * 60 * 1000;

export const isStale = (behind: number | null | undefined): boolean => typeof behind === "number" && behind >= STALE_COMMITS;

// Newer than installed, but the installed one still works (never forced).
export const workflowUpdateAvailable = (seen: number | null | undefined, provider: string | null | undefined): boolean =>
  typeof seen === "number" && seen >= requiredWorkflowVersion(provider) && seen < WORKFLOW_VERSION;

export type Freshness = { knowledgeBehind: number | null; workflowVersionSeen: number | null; checkedAt: string | null };

export async function refreshFreshness(
  userId: string,
  projectId: string,
  opts: { gh?: GitHubApi; now?: Date; force?: boolean } = {}
): Promise<Freshness | null> {
  const gh = opts.gh ?? realGithub;
  const now = opts.now ?? new Date();
  const p = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!p) return null;
  const cached = (): Freshness => ({ knowledgeBehind: p.knowledgeBehind, workflowVersionSeen: p.workflowVersionSeen, checkedAt: p.freshnessCheckedAt ? p.freshnessCheckedAt.toISOString() : null });
  if (!p.installationId || !p.repoOwner || !p.repoName) return cached();
  if (await repoAccessProblem(p)) return cached();
  if (!opts.force && p.freshnessCheckedAt && now.getTime() - p.freshnessCheckedAt.getTime() < FRESHNESS_TTL_MS) return cached();

  const map = (p.envBranches || {}) as Record<string, string>;
  const ref = map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
  try {
    const wf = await gh.getFile(p.installationId, p.repoOwner, p.repoName, WORKFLOW_PATH, ref);
    const learned = knowledgeFor(p.knowledge ?? null, p.context).learnedSha;
    const behind = learned ? await gh.commitsAhead(p.installationId, p.repoOwner, p.repoName, learned, ref) : null;
    const data = { knowledgeBehind: learned ? behind : null, workflowVersionSeen: wf ? workflowVersion(wf.content) : null, freshnessCheckedAt: now };
    await db.project.update({ where: { id: p.id }, data });
    return { knowledgeBehind: data.knowledgeBehind, workflowVersionSeen: data.workflowVersionSeen, checkedAt: now.toISOString() };
  } catch {
    return cached(); // a GitHub hiccup (or rate limit) means "no news": keep what we knew, and look again next time
  }
}
