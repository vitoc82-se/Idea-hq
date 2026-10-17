import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { github } from "@/lib/github/client";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { safeCommand } from "@/lib/runs/workflow";
import { WORKFLOW_PATH } from "@/lib/runs/state";

const BRANCH = /^[A-Za-z0-9._\/-]{1,100}$/;

// The project's repo link plus what the user can pick from. Also refreshes
// `workflowInstalled` so the UI notices when the setup PR was merged.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId } });
    if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const installs = await db.githubInstallation.findMany({ where: { userId: auth.userId } });
    const available = [];
    for (const inst of installs) {
      try {
        available.push({ installationId: inst.id, repos: await github.listRepos(inst.id) });
      } catch {
        available.push({ installationId: inst.id, repos: [], error: "Could not list repos" });
      }
    }

    let workflowInstalled = p.workflowInstalled;
    if (p.installationId && p.repoOwner && p.repoName && !workflowInstalled) {
      const map = (p.envBranches || {}) as Record<string, string>;
      const base = map[p.defaultEnv || ""] || Object.values(map)[0];
      if (base && (await github.fileExists(p.installationId, p.repoOwner, p.repoName, WORKFLOW_PATH, base).catch(() => false))) {
        workflowInstalled = true;
        await db.project.update({ where: { id: p.id }, data: { workflowInstalled: true } });
      }
    }
    return NextResponse.json({
      appConfigured: !!process.env.GITHUB_APP_SLUG,
      project: {
        installationId: p.installationId, repoOwner: p.repoOwner, repoName: p.repoName,
        envBranches: p.envBranches, defaultEnv: p.defaultEnv, autoMerge: p.autoMerge,
        buildCommand: p.buildCommand, testCommand: p.testCommand,
        workflowInstalled, setupPrNumber: p.setupPrNumber,
      },
      available,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
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

    const changedRepo = p.repoOwner !== repo.owner || p.repoName !== repo.name || p.installationId !== installationId;
    const updated = await db.project.update({
      where: { id: p.id },
      data: {
        installationId, repoOwner: repo.owner, repoName: repo.name,
        envBranches: env, defaultEnv, autoMerge: !!b.autoMerge, buildCommand, testCommand,
        ...(changedRepo ? { workflowInstalled: false, setupPrNumber: null } : {}),
      },
    });
    return NextResponse.json({ ok: true, workflowInstalled: updated.workflowInstalled });
  } catch (e) {
    return errorResponse(e);
  }
}
