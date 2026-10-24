import { github, type GitHubApi } from "@/lib/github/client";
import { repoAccessProblem } from "@/lib/github/access";
import { liveInventory } from "./repo-inventory";
import { projectPromptContext } from "./project-context";

type P = { name: string; context: string | null; installationId?: number | null; repoOwner?: string | null; repoName?: string | null; envBranches?: unknown; defaultEnv?: string | null };

// The grounding for an AI call about one of the owner's projects: the project's summary and, when its repository can be
// read, the repository's own inventory. Never fails the call: without a repo, access or an answer in time, the AI gets the
// summary alone.
export async function groundedContext(project: P & Parameters<typeof repoAccessProblem>[0], gh: GitHubApi = github): Promise<string> {
  let inventory: string | null = null;
  try {
    if (project.installationId && project.repoOwner && project.repoName && !(await repoAccessProblem(project))) {
      const map = (project.envBranches || {}) as Record<string, string>;
      const ref = map[project.defaultEnv || ""] || Object.values(map)[0] || "main";
      inventory = await liveInventory(gh, project.installationId, project.repoOwner, project.repoName, ref);
    }
  } catch {
    inventory = null;
  }
  return projectPromptContext(project, inventory);
}
