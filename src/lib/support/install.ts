import { db } from "@/lib/db";
import { approveRun, assertCanStartBuild, startRun, RunError } from "@/lib/runs/engine";

// "Add it for me": turns the embed snippet into an ordinary Idea HQ change. An
// idea with a ready-made plan is created, a run is started in the user's own
// GitHub, and the result is a pull request the owner reviews and merges like any
// other. Nothing reaches the live site until the owner merges it.

export const INSTALL_IDEA_TITLE = "Add the customer support Help button";

export function installPlan(p: { snippet: string; key: string; origin: string }): string {
  return [
    "# Add the customer support Help button",
    "",
    "Add one small script to the website so every public page shows a floating \"Help\" button that opens the hosted support widget.",
    "",
    "## The script",
    "",
    "```html",
    p.snippet,
    "```",
    "",
    "## What to do",
    "",
    "1. Find the one shared place that renders every public page (the root layout or base template) and add the script just before the closing `</body>` tag. Add it once, not per page.",
    "2. In a Next.js app use `next/script` with `strategy=\"lazyOnload\"` and `src` set to the script address above (inside the root layout's `<body>`). In plain HTML use the tag exactly as shown, with `defer`.",
    `3. The support key is \`${p.key}\`. Do not change it, do not inline or copy the script's contents, and do not load anything else from ${p.origin}.`,
    "4. If the project sets a Content-Security-Policy, allow `script-src` and `frame-src` for " + p.origin + ". If it sets none, do not add one.",
    "5. Do not change anything else: no styling, no copy, no unrelated files, no dependency changes.",
    "6. Keep the existing build and tests passing. Do not add a test unless one is trivial.",
    "",
    "## Done when",
    "",
    "The site builds, and the script tag appears once in the rendered pages.",
  ].join("\n");
}

export type InstallResult = { ideaId: string; runId: string };

// Creates (or reuses) the idea and starts the run. Throws RunError with a plain
// message when the project is not ready yet.
export async function installSupport(userId: string, projectId: string, snippet: string, key: string, origin: string): Promise<InstallResult> {
  await assertCanStartBuild(userId); // before anything is created, so a switched-off account leaves no stray idea
  const project = await db.project.findFirst({ where: { id: projectId, userId } });
  if (!project) throw new RunError(404, "Project not found");
  if (!project.repoOwner || !project.repoName || !project.workflowInstalled || !project.secretConfirmed) {
    throw new RunError(409, "This project is not AI ready yet. Finish its setup first (Projects, Repo & AI setup), or copy the code and add it yourself.");
  }
  let idea = await db.idea.findFirst({ where: { projectId, userId, title: INSTALL_IDEA_TITLE, status: { not: "done" } } });
  const plan = installPlan({ snippet, key, origin });
  if (!idea) {
    idea = await db.idea.create({
      data: {
        userId, projectId, title: INSTALL_IDEA_TITLE, status: "considering", priority: "medium", complexity: "S", impact: "medium",
        notes: "Created by Support, Put it on your site, Add it for me.", plan, plannedAt: new Date(), tags: ["support"],
      },
    });
  } else if (idea.plan !== plan) {
    idea = await db.idea.update({ where: { id: idea.id }, data: { plan, plannedAt: new Date() } });
  }
  const run = await startRun(userId, idea.id);
  if (run.status === "awaiting_approval") await approveRun(userId, run.id);
  return { ideaId: idea.id, runId: run.id };
}

// The latest state of an earlier install attempt, for the settings page.
export async function installStatus(userId: string, projectId: string): Promise<{ ideaId: string; runStatus: string | null; prNumber: number | null } | null> {
  const idea = await db.idea.findFirst({ where: { projectId, userId, title: INSTALL_IDEA_TITLE }, orderBy: { createdAt: "desc" } });
  if (!idea) return null;
  const run = await db.run.findFirst({ where: { ideaId: idea.id, userId, kind: "implement" }, orderBy: { createdAt: "desc" } });
  return { ideaId: idea.id, runStatus: run?.status ?? null, prNumber: run?.prNumber ?? null };
}
