import { db } from "@/lib/db";
import { github as realGithub, type GitHubApi } from "@/lib/github/client";
import {
  WORKFLOW_FILE,
  WORKFLOW_PATH,
  canTransition,
  isActive,
  isTerminal,
  runBranch,
} from "./state";
import { buildPrompt, WORKFLOW_VERSION, workflowVersion } from "./workflow";
import { recommendTier, resolveTier, type Override, type Tier } from "./policy";

export class RunError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Deps = { gh?: GitHubApi; now?: () => Date };
const g = (d?: Deps) => d?.gh ?? realGithub;

// How long a dispatched/running run may stay silent before reconcile fails it.
// Workflow timeout is 30 min; allow slack for queueing.
export const STUCK_AFTER_MS = 45 * 60 * 1000;
export const RECONCILE_COOLDOWN_MS = 15 * 1000;

type RunRow = NonNullable<Awaited<ReturnType<typeof db.run.findUnique>>>;
type ProjectRow = NonNullable<Awaited<ReturnType<typeof db.project.findUnique>>>;

function repoOf(p: ProjectRow) {
  if (!p.installationId || !p.repoOwner || !p.repoName) {
    throw new RunError(409, "Connect a GitHub repo to this project first.");
  }
  return { i: p.installationId, owner: p.repoOwner, repo: p.repoName };
}

function envBase(p: ProjectRow, env?: string | null): { env: string; base: string } {
  const map = (p.envBranches || {}) as Record<string, string>;
  const name = env || p.defaultEnv || Object.keys(map)[0];
  const base = name ? map[name] : undefined;
  if (!name || !base) throw new RunError(409, "Set an environment and base branch for this project.");
  return { env: name, base };
}

async function loadOwned(userId: string, runId: string) {
  const run = await db.run.findFirst({ where: { id: runId, userId }, include: { project: true, idea: true } });
  if (!run) throw new RunError(404, "Run not found");
  return run;
}

// Move a run to `to` only if its current status is a legal predecessor. The
// guard is in the WHERE clause so two racing webhooks cannot both win.
async function transition(run: { id: string; status: string }, to: string, data: Record<string, unknown> = {}) {
  if (!canTransition(run.status, to)) return false;
  const froms = ["awaiting_approval", "dispatched", "running", "pr_open"].filter((f) => canTransition(f, to));
  const res = await db.run.updateMany({
    where: { id: run.id, status: { in: froms } },
    data: { ...data, status: to },
  });
  return res.count > 0;
}

// ---- start / approve -------------------------------------------------------

export async function startRun(userId: string, ideaId: string, deps?: Deps) {
  const idea = await db.idea.findFirst({ where: { id: ideaId, userId }, include: { project: true } });
  if (!idea) throw new RunError(404, "Idea not found");
  if (!idea.plan) throw new RunError(409, "Create the plan first (Promote to plan), then implement.");
  const storyCount = await db.idea.count({ where: { parentId: idea.id, userId } });
  if (storyCount > 0) {
    throw new RunError(409, "This idea is split into stories. Implement the stories one at a time, in order. Open the next story below.");
  }
  const p = idea.project;
  repoOf(p);
  if (!p.workflowInstalled) throw new RunError(409, "Finish the repo setup first (merge the setup PR).");
  const { env, base } = envBase(p);

  if (idea.blockedBy.length) {
    const open = await db.idea.count({ where: { userId, id: { in: idea.blockedBy }, status: { not: "done" } } });
    if (open > 0) throw new RunError(409, "This idea is blocked by ideas that are not done yet.");
  }

  // Double click / second tab: reuse the run that is waiting for approval.
  const existing = await db.run.findFirst({
    where: { ideaId, userId, kind: "implement", status: "awaiting_approval" },
  });
  if (existing) return existing;

  void deps;
  return db.run.create({
    data: { userId, projectId: p.id, ideaId, kind: "implement", status: "awaiting_approval", env, baseBranch: base, plan: idea.plan },
  });
}

async function lockAndCheckIdle(tx: typeof db, projectId: string) {
  await (tx as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${projectId}))) AS l`;
  const busy = await tx.run.count({ where: { projectId, status: { in: ["dispatched", "running"] } } });
  if (busy > 0) throw new RunError(409, "Another run is already executing on this project. Wait for it to finish.");
}

async function preflight(p: ProjectRow, base: string, gh: GitHubApi) {
  const { i, owner, repo } = repoOf(p);
  const b = await gh.repoBranch(i, owner, repo, base);
  if (!b) throw new RunError(409, `Base branch "${base}" was not found in ${owner}/${repo}.`);
  const wf = await gh.getFile(i, owner, repo, WORKFLOW_PATH, base);
  if (!wf) {
    throw new RunError(409, `The Idea HQ workflow is missing on "${base}". Merge the setup PR first.`);
  }
  if (workflowVersion(wf.content) < WORKFLOW_VERSION) {
    throw new RunError(409, `The Idea HQ workflow in ${owner}/${repo} is outdated. Click "Update workflow" in the project's Repo & AI setup and merge that PR.`);
  }
  if (!(await gh.secretExists(i, owner, repo, "ANTHROPIC_API_KEY"))) {
    throw new RunError(409, `Add an ANTHROPIC_API_KEY secret to ${owner}/${repo} (Settings, Secrets and variables, Actions).`);
  }
  return b;
}

async function dispatch(run: RunRow, p: ProjectRow, prompt: string, tier: Tier, gh: GitHubApi) {
  const { i, owner, repo } = repoOf(p);
  try {
    await gh.dispatchWorkflow(i, owner, repo, WORKFLOW_FILE, run.baseBranch!, {
      run_id: run.id,
      branch: run.branch!,
      base: run.baseBranch!,
      prompt,
      model: tier.model,
      effort: tier.effort,
      max_turns: String(tier.maxTurns),
    });
  } catch (e) {
    await db.run.updateMany({
      where: { id: run.id, status: "dispatched" },
      data: { status: "failed", error: `Could not start the workflow: ${(e as Error).message}`, finishedAt: new Date() },
    });
    throw new RunError(502, `Could not start the workflow: ${(e as Error).message}`);
  }
}

// The tier we would pick for this run: from the idea's size and the project's
// bias, one step up for every earlier failed attempt on the same idea.
export async function recommendForRun(run: { ideaId: string | null; userId: string; id: string; project: { aiBias: string }; idea: { complexity: string | null } | null }) {
  const failed = run.ideaId
    ? await db.run.count({ where: { ideaId: run.ideaId, userId: run.userId, kind: "implement", status: "failed" } })
    : 0;
  return recommendTier(run.idea?.complexity, run.project.aiBias, failed);
}

export async function approveRun(userId: string, runId: string, deps?: Deps, override: Override = {}) {
  const gh = g(deps);
  const run = await loadOwned(userId, runId);
  if (run.status !== "awaiting_approval") throw new RunError(409, `Run is ${run.status}, not waiting for approval.`);
  const p = run.project;
  await preflight(p, run.baseBranch!, gh);
  const { tier } = resolveTier(await recommendForRun(run), override);

  const branch = runBranch(run.id);
  await db.$transaction(async (tx) => {
    await lockAndCheckIdle(tx as unknown as typeof db, p.id);
    const ok = await tx.run.updateMany({
      where: { id: run.id, status: "awaiting_approval" },
      data: { status: "dispatched", branch, startedAt: (deps?.now?.() ?? new Date()), model: tier.model, effort: tier.effort, maxTurns: tier.maxTurns },
    });
    if (ok.count === 0) throw new RunError(409, "Run was already started.");
  });
  const fresh = (await db.run.findUnique({ where: { id: run.id } }))!;
  if (run.ideaId) await db.idea.updateMany({ where: { id: run.ideaId, userId }, data: { status: "building" } });
  await dispatch(fresh, p, buildPrompt({ ideaTitle: run.idea?.title || "idea", plan: run.plan || "", testCommand: p.testCommand }), tier, gh);
  return fresh;
}

export async function reviseRun(userId: string, runId: string, instruction: string, deps?: Deps) {
  const gh = g(deps);
  if (!instruction.trim()) throw new RunError(400, "Describe what to change.");
  const run = await loadOwned(userId, runId);
  if (run.kind === "revert") throw new RunError(409, "Revert PRs cannot be revised.");
  if (run.status !== "pr_open") throw new RunError(409, "Only a run with an open PR can be revised.");
  const p = run.project;
  await preflight(p, run.baseBranch!, gh);
  await db.$transaction(async (tx) => {
    await lockAndCheckIdle(tx as unknown as typeof db, p.id);
    const ok = await tx.run.updateMany({
      where: { id: run.id, status: "pr_open" },
      data: { status: "dispatched", checksState: "pending", error: null },
    });
    if (ok.count === 0) throw new RunError(409, "Run changed, try again.");
  });
  const fresh = (await db.run.findUnique({ where: { id: run.id } }))!;
  // A revision keeps the tier the run started with.
  const rec = await recommendForRun(run);
  const { tier } = resolveTier(rec, { model: run.model, effort: run.effort, maxTurns: run.maxTurns });
  await dispatch(fresh, p, buildPrompt({ ideaTitle: run.idea?.title || "idea", plan: run.plan || "", revision: instruction.trim(), testCommand: p.testCommand }), tier, gh);
  return fresh;
}

// ---- merge / revert / cancel ----------------------------------------------

export type MergeResult = { merged: true; sha: string };

// Shared by the button and by auto-merge. Re-reads GitHub: a stored checksState
// is never trusted, and the merge is pinned to the head sha we verified.
export async function mergeRun(userId: string, runId: string, opts: { auto?: boolean } = {}, deps?: Deps): Promise<MergeResult> {
  const gh = g(deps);
  const run = await loadOwned(userId, runId);
  if (run.status !== "pr_open" || !run.prNumber) throw new RunError(409, "There is no open PR to merge.");
  const p = run.project;
  const { i, owner, repo } = repoOf(p);

  const pr = await gh.getPr(i, owner, repo, run.prNumber);
  if (pr.state !== "open") throw new RunError(409, "The PR is no longer open.");

  const sums = await gh.checkSummary(i, owner, repo, pr.headSha, run.kind !== "revert");
  if (sums.state === "red") throw new RunError(409, `Checks failed: ${sums.failing.join(", ")}`);
  if (run.kind !== "revert" && sums.state !== "green") throw new RunError(409, "Checks have not all passed yet.");

  if (opts.auto) {
    if (!p.autoMerge) throw new RunError(409, "Auto-merge is off for this project.");
    const b = await gh.repoBranch(i, owner, repo, pr.baseRef);
    if (!b?.protected) throw new RunError(409, "Auto-merge needs a protected base branch.");
    if (sums.state !== "green") throw new RunError(409, "Checks have not all passed yet.");
  }

  const merged = await gh.mergePr(i, owner, repo, run.prNumber, pr.headSha);
  await finishMerged(run, merged.sha);
  return { merged: true, sha: merged.sha };
}

async function finishMerged(
  run: { id: string; status: string; userId: string; ideaId: string | null; kind: string; prNumber: number | null },
  sha: string
) {
  const ok = await transition(run, "merged", { mergedSha: sha, finishedAt: new Date(), checksState: "green" });
  if (ok && run.ideaId && run.kind === "implement") {
    await db.idea.updateMany({
      where: { id: run.ideaId, userId: run.userId },
      data: {
        status: "done",
        closedAt: new Date(),
        closureNote: `Shipped by Idea HQ in PR #${run.prNumber} (run ${run.id}).`,
      },
    });
  }
}

export async function revertRun(userId: string, runId: string, deps?: Deps) {
  const gh = g(deps);
  const run = await loadOwned(userId, runId);
  if (run.status !== "merged" || !run.prNumber || run.kind === "revert") {
    throw new RunError(409, "Only a merged implementation can be reverted.");
  }
  const dup = await db.run.findFirst({ where: { parentRunId: run.id, kind: "revert", status: { in: ["pr_open", "merged"] } } });
  if (dup) throw new RunError(409, "A revert for this run already exists.");
  const p = run.project;
  const { i, owner, repo } = repoOf(p);
  const pr = await gh.getPr(i, owner, repo, run.prNumber);
  const rev = await gh.revertPr(i, owner, repo, pr.nodeId, `Revert: ${run.idea?.title || "Idea HQ change"}`);
  return db.run.create({
    data: {
      userId, projectId: p.id, ideaId: run.ideaId, kind: "revert", status: "pr_open",
      env: run.env, baseBranch: run.baseBranch, prNumber: rev.number, parentRunId: run.id, startedAt: new Date(),
    },
  });
}

export async function cancelRun(userId: string, runId: string, deps?: Deps) {
  const gh = g(deps);
  const run = await loadOwned(userId, runId);
  if (isTerminal(run.status)) throw new RunError(409, `Run is already ${run.status}.`);
  if (run.status === "pr_open" && run.prNumber) {
    const { i, owner, repo } = repoOf(run.project);
    await gh.closePr(i, owner, repo, run.prNumber).catch(() => undefined);
    await transition(run, "closed", { finishedAt: new Date() });
  } else {
    await transition(run, "cancelled", { finishedAt: new Date() });
  }
  return (await db.run.findUnique({ where: { id: run.id } }))!;
}

// ---- repo setup PR ---------------------------------------------------------

export async function openSetupPr(
  userId: string,
  projectId: string,
  appSlug: string,
  deps?: Deps
): Promise<{ number: number }> {
  const gh = g(deps);
  const { buildWorkflow } = await import("./workflow");
  const p = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!p) throw new RunError(404, "Project not found");
  const { i, owner, repo } = repoOf(p);
  const { base } = envBase(p);
  const b = await gh.repoBranch(i, owner, repo, base);
  if (!b) throw new RunError(409, `Base branch "${base}" not found.`);
  const existingFile = await gh.getFile(i, owner, repo, WORKFLOW_PATH, base);
  if (existingFile && workflowVersion(existingFile.content) >= WORKFLOW_VERSION) {
    await db.project.update({ where: { id: p.id }, data: { workflowInstalled: true } });
    throw new RunError(409, "The workflow is already installed on that branch.");
  }
  // Clicking twice must not open a second PR: reuse the one still waiting.
  if (p.setupPrNumber) {
    const existing = await gh.getPr(i, owner, repo, p.setupPrNumber).catch(() => null);
    if (existing && existing.state === "open") return { number: existing.number };
  }
  const branch = `idea-hq/setup-${Date.now().toString(36)}`;
  await gh.createBranch(i, owner, repo, branch, b.sha);
  await gh.putFile(
    i, owner, repo, WORKFLOW_PATH, branch,
    buildWorkflow({ appSlug, buildCommand: p.buildCommand, testCommand: p.testCommand }),
    existingFile ? "Update Idea HQ workflow" : "Add Idea HQ workflow",
    existingFile?.sha
  );
  const pr = await gh.openPr(i, owner, repo, {
    head: branch,
    base,
    title: existingFile ? "Update Idea HQ workflow" : "Add Idea HQ workflow",
    body: "Lets Idea HQ run an AI implementation in this repo.\n\nIt uses the `ANTHROPIC_API_KEY` Actions secret, a 30 minute timeout and a turn cap. Review the file, merge it, then add the secret.",
  });
  await db.project.update({ where: { id: p.id }, data: { setupPrNumber: pr.number } });
  return pr;
}

// ---- webhooks --------------------------------------------------------------

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function runForRepo(runId: string, fullName: string) {
  const run = await db.run.findUnique({ where: { id: runId }, include: { project: true, idea: true } });
  if (!run) return null;
  // The run id comes from text the repo owner controls (run-name, status
  // description). Only accept it from the repo the run was actually sent to.
  const want = `${run.project.repoOwner}/${run.project.repoName}`.toLowerCase();
  if (want !== fullName.toLowerCase()) return null;
  return run;
}

async function runForPr(fullName: string, prNumber: number) {
  const [owner, name] = fullName.split("/");
  return db.run.findFirst({
    where: { prNumber, project: { repoOwner: { equals: owner, mode: "insensitive" }, repoName: { equals: name, mode: "insensitive" } } },
    include: { project: true, idea: true },
    orderBy: { createdAt: "desc" },
  });
}

const RUN_ID = /idea-hq ([a-z0-9]+)/i;

export async function handleWebhook(event: string, payload: Payload, deliveryId: string, deps?: Deps): Promise<string> {
  try {
    await db.webhookDelivery.create({ data: { id: deliveryId } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return "duplicate";
    throw e;
  }
  try {
    return await processEvent(event, payload, g(deps));
  } catch (e) {
    // Forget the delivery so GitHub's redelivery is processed, not dropped.
    await db.webhookDelivery.deleteMany({ where: { id: deliveryId } }).catch(() => undefined);
    throw e;
  }
}

async function processEvent(event: string, payload: Payload, gh: GitHubApi): Promise<string> {

  const full: string | undefined = payload.repository?.full_name;
  if (!full) return "ignored";

  if (event === "workflow_run") {
    const wr = payload.workflow_run;
    const m = RUN_ID.exec(wr?.display_title || "");
    if (!m) return "ignored";
    const run = await runForRepo(m[1], full);
    if (!run) return "ignored";
    if (payload.action === "in_progress" || payload.action === "requested") {
      if (run.status === "dispatched") await transition(run, "running", { ghRunId: String(wr.id) });
      return "running";
    }
    if (payload.action === "completed") return onWorkflowCompleted(run, wr, gh);
    return "ignored";
  }

  if (event === "status") {
    if (payload.context !== "idea-hq/run") return "ignored";
    const desc: string = payload.description || "";
    const m = /run=([a-z0-9]+)/i.exec(desc);
    if (!m) return "ignored";
    const run = await runForRepo(m[1], full);
    if (!run) return "ignored";
    const cost = /cost=([0-9.]+)/.exec(desc);
    const turns = /turns=([0-9]+)/.exec(desc);
    await db.run.update({
      where: { id: run.id },
      data: { costUsd: cost ? Number(cost[1]) : undefined, turns: turns ? Number(turns[1]) : undefined },
    });
    await recomputeChecks(run, gh);
    return "status";
  }

  if (event === "check_suite" || event === "check_run" || event === "pull_request") {
    const prs: { number: number }[] =
      event === "pull_request" ? [{ number: payload.pull_request?.number ?? payload.number }] : payload[event]?.pull_requests || [];
    let handled = "ignored";
    for (const pr of prs) {
      if (!pr?.number) continue;
      const run = await runForPr(full, pr.number);
      if (!run) continue;
      if (event === "pull_request") handled = await onPullRequest(run, payload, gh);
      else if (payload.action === "completed") {
        await recomputeChecks(run, gh);
        handled = "checks";
      }
    }
    return handled;
  }

  return "ignored";
}

async function onWorkflowCompleted(run: RunRow & { project: ProjectRow; idea: { title: string } | null }, wr: Payload, gh: GitHubApi) {
  if (isTerminal(run.status)) return "ignored";
  const ok = wr.conclusion === "success";
  const { i, owner, repo } = repoOf(run.project);

  if (!ok) {
    await transition(run, "failed", {
      ghRunId: String(wr.id),
      error: `The workflow ${wr.conclusion || "did not finish"}. See ${wr.html_url || "the Actions tab"}.`,
      finishedAt: new Date(),
    });
    return "failed";
  }
  if (run.prNumber) {
    // Revision: same PR, new commit.
    const pr = await gh.getPr(i, owner, repo, run.prNumber);
    await transition(run, "pr_open", { headSha: pr.headSha, checksState: "pending", ghRunId: String(wr.id) });
    await recomputeChecks({ ...run, status: "pr_open", prNumber: run.prNumber, headSha: pr.headSha }, gh);
    return "revised";
  }
  const base = run.baseBranch!;
  const branch = await gh.repoBranch(i, owner, repo, run.branch!);
  const head = branch?.sha;
  if (!head) {
    await transition(run, "failed", { error: "The workflow finished but pushed no branch.", finishedAt: new Date() });
    return "failed";
  }
  const base0 = await gh.repoBranch(i, owner, repo, base);
  if (base0 && base0.sha === head) {
    await transition(run, "failed", { error: "The AI made no changes.", finishedAt: new Date() });
    return "failed";
  }
  // Open the PR with the App token, so the repo's own pull_request CI fires.
  const pr = await gh.openPr(i, owner, repo, {
    head: run.branch!,
    base,
    title: run.idea?.title || "Idea HQ change",
    body: `Implemented by Idea HQ (run ${run.id}).\n\nPlan:\n\n${run.plan || ""}`.slice(0, 60000),
  });
  await transition(run, "pr_open", { prNumber: pr.number, headSha: head, checksState: "pending", ghRunId: String(wr.id) });
  return "pr_opened";
}

async function recomputeChecks(run: { id: string; status: string; kind: string; prNumber: number | null; headSha: string | null; project: ProjectRow; userId: string }, gh: GitHubApi) {
  if (run.status !== "pr_open" || !run.prNumber || !run.headSha) return;
  const { i, owner, repo } = repoOf(run.project);
  const sums = await gh.checkSummary(i, owner, repo, run.headSha, run.kind !== "revert");
  await db.run.updateMany({ where: { id: run.id, status: "pr_open" }, data: { checksState: sums.state } });
  if (sums.state === "green" && run.project.autoMerge && run.kind === "implement") {
    await mergeRun(run.userId, run.id, { auto: true }, { gh }).catch(() => undefined); // guard failures just leave it for a human
  }
}

async function onPullRequest(run: RunRow & { project: ProjectRow; idea: { title: string } | null }, payload: Payload, gh: GitHubApi) {
  const pr = payload.pull_request;
  if (payload.action === "closed") {
    if (pr?.merged) {
      await finishMerged(run, pr.merge_commit_sha || "");
      return "merged";
    }
    await transition(run, "closed", { finishedAt: new Date() });
    return "closed";
  }
  if (payload.action === "synchronize" && pr?.head?.sha && run.status === "pr_open") {
    await db.run.updateMany({ where: { id: run.id, status: "pr_open" }, data: { headSha: pr.head.sha, checksState: "pending" } });
    return "synchronized";
  }
  void gh;
  return "ignored";
}

// ---- reconcile (page view) -------------------------------------------------

export async function reconcileRun(runId: string, deps?: Deps): Promise<void> {
  const gh = g(deps);
  const now = deps?.now?.() ?? new Date();
  const run = await db.run.findUnique({ where: { id: runId }, include: { project: true, idea: true } });
  if (!run || isTerminal(run.status)) return;
  if (now.getTime() - run.updatedAt.getTime() < RECONCILE_COOLDOWN_MS) return;

  if (isActive(run.status)) {
    const since = (run.startedAt ?? run.createdAt).getTime();
    if (now.getTime() - since > STUCK_AFTER_MS) {
      await transition(run, "failed", { error: "No result from GitHub in time. Check the Actions tab.", finishedAt: now });
    }
    return;
  }
  if (run.status === "pr_open" && run.prNumber) {
    const { i, owner, repo } = repoOf(run.project);
    const pr = await gh.getPr(i, owner, repo, run.prNumber);
    if (pr.merged) return void (await finishMerged(run, pr.mergeCommitSha || ""));
    if (pr.state === "closed") return void (await transition(run, "closed", { finishedAt: now }));
    await recomputeChecks({ ...run, headSha: pr.headSha }, gh);
    await db.run.updateMany({ where: { id: run.id, status: "pr_open" }, data: { headSha: pr.headSha } });
  }
}
