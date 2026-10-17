import { db } from "@/lib/db";
import { github as realGithub, GitHubRateLimitError, type GitHubApi } from "@/lib/github/client";
import { RunError } from "./engine";
import { FULL_TTL_MS, fullCache } from "./setup-cache";
import { WORKFLOW_PATH } from "./state";
import { WORKFLOW_VERSION, workflowVersion } from "./workflow";

// The guided onboarding for one project. Every step's state is derived from the
// real world (database + GitHub), never from "I clicked next", so the page
// can always tell the user what is actually missing.

export type StepId = "github" | "repo" | "commands" | "workflow" | "secret" | "practice";
export type StepStatus = "done" | "todo" | "blocked" | "warn";
export type SetupStep = { id: StepId; title: string; status: StepStatus; detail?: string; url?: string };

export type SetupStatus = {
  steps: SetupStep[];
  done: number;
  total: number;
  currentId: StepId | null;
  repo: { owner: string; name: string } | null;
  suggestions: { build: string | null; test: string | null };
  otherRepos: string[]; // other connected repos of this user, for the multi-repo key command
};

// Suggest commands from a package.json. Prefer a dedicated typecheck as the
// "build" gate (fast, no env needed), else the real build.
export function suggestCommands(pkgJson: string | null | undefined): { build: string | null; test: string | null } {
  if (!pkgJson) return { build: null, test: null };
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(pkgJson).scripts || {};
  } catch {
    return { build: null, test: null };
  }
  const build = scripts.typecheck ? "npm run typecheck" : scripts.build ? "npm run build" : null;
  const test = scripts.test && !/no test specified/i.test(scripts.test) ? "npm test" : null;
  return { build, test };
}

// A GitHub failure normally just means "not there" for that one step, but a rate
// limit must surface, or a limited connection looks like a broken setup.
const soft = <T,>(v: T) => (e: unknown): T => {
  if (e instanceof GitHubRateLimitError) throw e;
  return v;
};

const TITLES: Record<StepId, string> = {
  github: "Connect GitHub",
  repo: "Choose the repo and branch",
  commands: "Set the build and test commands",
  workflow: "Install the Idea HQ workflow",
  secret: "Add your Anthropic API key to the repo",
  practice: "Run a small practice idea",
};

export async function getSetupStatus(
  userId: string,
  projectId: string,
  opts: { quick?: boolean; fresh?: boolean; gh?: GitHubApi; now?: () => number } = {}
): Promise<SetupStatus> {
  const gh = opts.gh ?? realGithub;
  const now = opts.now ?? Date.now;
  const cacheKey = `${userId}:${projectId}`;
  if (!opts.quick && !opts.fresh) {
    const hit = fullCache.get(cacheKey);
    if (hit && now() - hit.at < FULL_TTL_MS) return hit.value;
  }
  const p = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!p) throw new RunError(404, "Project not found");

  const installs = await db.githubInstallation.count({ where: { userId } });
  const hasRepo = !!(p.installationId && p.repoOwner && p.repoName);
  const envs = (p.envBranches || {}) as Record<string, string>;
  const base = envs[p.defaultEnv || ""] || Object.values(envs)[0] || null;

  // Quick mode makes no GitHub calls: it trusts what the last full check stored.
  let workflowDone = p.workflowInstalled;
  let workflowOutdated = false;
  let secretDone: boolean | null = opts.quick ? (workflowDone ? p.secretConfirmed : false) : null;
  let suggestions = { build: null as string | null, test: null as string | null };

  if (!opts.quick && hasRepo && base) {
    const i = p.installationId!, o = p.repoOwner!, r = p.repoName!;
    const wf = await gh.getFile(i, o, r, WORKFLOW_PATH, base).catch(soft(null));
    workflowDone = !!wf && workflowVersion(wf.content) >= WORKFLOW_VERSION;
    workflowOutdated = !!wf && !workflowDone;
    secretDone = workflowDone ? await gh.secretExists(i, o, r, "ANTHROPIC_API_KEY").catch(soft(false)) : false;
    // Only needed to suggest commands before the user has confirmed them.
    if (!p.commandsConfirmed) {
      const pkg = await gh.getFile(i, o, r, "package.json", base).catch(soft(null));
      suggestions = suggestCommands(pkg?.content);
    }
    // Remember what we saw, so cheap polls can answer without asking GitHub.
    if (workflowDone !== p.workflowInstalled || secretDone !== p.secretConfirmed) {
      await db.project.update({ where: { id: p.id }, data: { workflowInstalled: workflowDone, secretConfirmed: secretDone } });
    }
  }

  const runs = await db.run.findMany({ where: { projectId: p.id, userId, kind: "implement" } });
  const merged = runs.some((r) => r.status === "merged");
  const hasRun = runs.length > 0;
  // A run that got as far as the workflow proves the secret existed.
  if (secretDone === null) secretDone = hasRun && workflowDone;

  const steps: SetupStep[] = [];
  const add = (id: StepId, status: StepStatus, detail?: string, url?: string) => steps.push({ id, title: TITLES[id], status, detail, url });

  add("github", installs > 0 || hasRepo ? "done" : "todo", installs > 0 ? undefined : "Install the Idea HQ GitHub App and pick which repos it may see.", "/api/github/install");
  add("repo", hasRepo && base ? "done" : steps[0].status === "done" ? "todo" : "blocked", hasRepo ? `${p.repoOwner}/${p.repoName} → ${base}` : undefined);
  add("commands", p.commandsConfirmed ? "done" : steps[1].status === "done" ? "todo" : "blocked",
    p.commandsConfirmed ? [p.buildCommand, p.testCommand].filter(Boolean).join(" · ") || "No checks configured" : undefined);
  const repoUrl = hasRepo ? `https://github.com/${p.repoOwner}/${p.repoName}` : undefined;
  add("workflow", workflowDone ? "done" : steps[2].status !== "done" ? "blocked" : workflowOutdated ? "warn" : "todo",
    workflowOutdated ? "Your installed workflow is outdated. Update it to keep running." : p.setupPrNumber && !workflowDone ? `Merge setup PR #${p.setupPrNumber} on GitHub.` : undefined,
    p.setupPrNumber && repoUrl && !workflowDone ? `${repoUrl}/pull/${p.setupPrNumber}` : undefined);
  add("secret", secretDone ? "done" : steps[3].status !== "done" ? "blocked" : "todo",
    secretDone ? undefined : "Name it ANTHROPIC_API_KEY. Idea HQ never sees the key, it stays in GitHub.",
    repoUrl ? `${repoUrl}/settings/secrets/actions/new` : undefined);
  add("practice", merged ? "done" : steps[4].status !== "done" ? "blocked" : hasRun ? "warn" : "todo",
    merged ? "You have shipped a change with Idea HQ." : hasRun ? "A practice run exists. Finish it from the idea page." : "Try a tiny idea, like a one-line README change, before real work.");

  const done = steps.filter((s) => s.status === "done").length;
  const current = steps.find((s) => s.status !== "done");
  const mine = await db.project.findMany({ where: { userId, repoOwner: { not: null } } });
  const otherRepos = mine
    .filter((x) => x.id !== p.id && x.repoOwner && x.repoName)
    .map((x) => `${x.repoOwner}/${x.repoName}`);

  const result: SetupStatus = {
    steps, done, total: steps.length, currentId: current ? current.id : null,
    repo: hasRepo ? { owner: p.repoOwner!, name: p.repoName! } : null,
    suggestions, otherRepos: Array.from(new Set(otherRepos)),
  };
  if (!opts.quick) fullCache.set(cacheKey, { at: now(), value: result });
  return result;
}
