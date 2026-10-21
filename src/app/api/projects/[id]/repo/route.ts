import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { github, installationConfigureUrl } from "@/lib/github/client";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { safeCommand } from "@/lib/runs/workflow";
import { invalidateSetupCache } from "@/lib/runs/setup-cache";
import { getProvider, listProviders, isProviderId } from "@/lib/providers";
import { WORKFLOW_PATH } from "@/lib/runs/state";
import { requiredWorkflowVersion, workflowVersion } from "@/lib/runs/workflow";

const BRANCH = /^[A-Za-z0-9._\/-]{1,100}$/;

// The project's repo link plus what the user can pick from. Also refreshes
// `workflowInstalled` so the UI notices when the setup PR was merged.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId } });
    if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const installs = await db.githubInstallation.findMany({ where: { userId: auth.userId } });
    const available = [];
    for (const inst of installs) {
      try {
        available.push({ installationId: inst.id, repos: await github.listRepos(inst.id), configureUrl: await installationConfigureUrl(inst.id) });
      } catch {
        available.push({ installationId: inst.id, repos: [], error: "Could not list repos" });
      }
    }

    let workflowInstalled = p.workflowInstalled;
    let workflowOutdated = false;
    if (p.installationId && p.repoOwner && p.repoName) {
      const map = (p.envBranches || {}) as Record<string, string>;
      const base = map[p.defaultEnv || ""] || Object.values(map)[0];
      const file = base ? await github.getFile(p.installationId, p.repoOwner, p.repoName, WORKFLOW_PATH, base).catch(() => null) : null;
      const current = !!file && workflowVersion(file.content) >= requiredWorkflowVersion(p.aiProvider);
      workflowOutdated = !!file && !current;
      if (current !== p.workflowInstalled) {
        workflowInstalled = current;
        await db.project.update({ where: { id: p.id }, data: { workflowInstalled: current } });
      }
      // Remember that the API key secret exists (one cheap call), so the progress
      // chip does not stay on "not done" for a key that is already there.
      if (current && !p.secretConfirmed) {
        const has = await github.secretExists(p.installationId, p.repoOwner, p.repoName, getProvider(p.aiProvider).secretName).catch(() => false);
        if (has) await db.project.update({ where: { id: p.id }, data: { secretConfirmed: true } });
      }
    }
    return NextResponse.json({
      appConfigured: !!process.env.GITHUB_APP_SLUG,
      project: {
        installationId: p.installationId, repoOwner: p.repoOwner, repoName: p.repoName,
        envBranches: p.envBranches, defaultEnv: p.defaultEnv, autoMerge: p.autoMerge,
        buildCommand: p.buildCommand, testCommand: p.testCommand, aiBias: p.aiBias, aiProvider: getProvider(p.aiProvider).id,
        workflowInstalled, workflowOutdated, setupPrNumber: p.setupPrNumber,
      },
      available,
      // What a user may pick, and the facts the UI needs (secret name, where to get a key).
      providers: listProviders({ enabledOnly: true }).map((x) => ({ id: x.id, label: x.label, secretName: x.secretName, keyHelpUrl: x.keyHelpUrl, keyHelpText: x.keyHelpText })),
      siblings: (await db.project.findMany({ where: { userId: auth.userId, id: { not: p.id }, repoOwner: { not: null } }, select: { id: true, name: true, repoOwner: true, repoName: true, aiProvider: true } })).map((x) => ({ id: x.id, name: x.name, repo: `${x.repoOwner}/${x.repoName}`, provider: getProvider(x.aiProvider).id })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId } });
    if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const b = await request.json().catch(() => null);
    if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const installationId = Number(b.installationId);
    const mine = await db.githubInstallation.findFirst({ where: { userId: auth.userId, id: installationId } });
    if (!mine) return NextResponse.json({ error: "That GitHub installation is not connected to your account." }, { status: 403 });

    const repos = await github.listRepos(installationId);
    const repo = repos.find((r) => r.owner === b.repoOwner && r.name === b.repoName);
    if (!repo) return NextResponse.json({ error: "That repo is not part of the installation." }, { status: 400 });

    const env = b.envBranches;
    if (!env || typeof env !== "object" || !Object.keys(env).length || Object.keys(env).length > 5) {
      return NextResponse.json({ error: "Add 1 to 5 environments, each mapped to a branch." }, { status: 400 });
    }
    for (const [name, branch] of Object.entries(env)) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(name) || typeof branch !== "string" || !BRANCH.test(branch)) {
        return NextResponse.json({ error: `Invalid environment "${name}".` }, { status: 400 });
      }
      if (!(await github.repoBranch(installationId, repo.owner, repo.name, branch))) {
        return NextResponse.json({ error: `Branch "${branch}" does not exist in ${repo.owner}/${repo.name}.` }, { status: 400 });
      }
    }
    const defaultEnv = b.defaultEnv && env[b.defaultEnv] ? b.defaultEnv : Object.keys(env)[0];

    let buildCommand: string | null, testCommand: string | null;
    try {
      buildCommand = safeCommand(b.buildCommand);
      testCommand = safeCommand(b.testCommand);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    // Choosing a provider: only one that is switched on (or the one already set).
    let aiProvider = getProvider(p.aiProvider).id;
    if (b.aiProvider !== undefined) {
      if (!isProviderId(b.aiProvider)) return NextResponse.json({ error: "Unknown AI provider." }, { status: 400 });
      if (b.aiProvider !== aiProvider && !getProvider(b.aiProvider).enabled()) {
        return NextResponse.json({ error: `${getProvider(b.aiProvider).label} is not available yet.` }, { status: 400 });
      }
      aiProvider = b.aiProvider;
    }
    const providerChanged = aiProvider !== getProvider(p.aiProvider).id;

    const changedRepo = p.repoOwner !== repo.owner || p.repoName !== repo.name || p.installationId !== installationId;
    const updated = await db.project.update({
      where: { id: p.id },
      data: {
        installationId, repoOwner: repo.owner, repoName: repo.name,
        envBranches: env, defaultEnv, autoMerge: !!b.autoMerge, buildCommand, testCommand, commandsConfirmed: true, aiProvider, ...(providerChanged ? { secretConfirmed: false } : {}), aiBias: ["saver", "auto", "max"].includes(b.aiBias) ? b.aiBias : p.aiBias,
        ...(changedRepo ? { workflowInstalled: false, setupPrNumber: null } : {}),
      },
    });
    invalidateSetupCache(p.id);
    return NextResponse.json({ ok: true, workflowInstalled: updated.workflowInstalled });
  } catch (e) {
    return errorResponse(e);
  }
}
