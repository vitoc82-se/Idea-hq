import { db } from "@/lib/db";
import { isOwner } from "@/lib/owner";
import { getSetupStatus } from "@/lib/runs/setup";
import { type GitHubApi } from "@/lib/github/client";

// First-login journey, derived from real state (never from "I clicked next").
// 1 approval -> 2 project -> 3-7 repo setup -> 8 context -> 9 idea -> 10 plan
// -> 11 run -> 12 shipped.


// What the journey card on the welcome page needs to know about an idea (see app/(app)/ideas/idea-journey.tsx).
export type OnboardIdea = {
  id: string; title: string; plan: string | null; complexity: string | null;
  scope: string | null; status: string; closureNote: string | null; closedAt: string | null;
};
const toOnboardIdea = (i: { id: string; title: string; plan: string | null; complexity: string | null; scope: string | null; status: string; closureNote: string | null; closedAt: Date | null }): OnboardIdea => ({
  id: i.id, title: i.title, plan: i.plan ?? null, complexity: i.complexity ?? null,
  scope: i.scope ?? null, status: i.status, closureNote: i.closureNote ?? null, closedAt: i.closedAt ? i.closedAt.toISOString() : null,
});

export type OnboardStatus = "done" | "todo" | "blocked" | "warn";
export type OnboardStep = { id: string; title: string; status: OnboardStatus; phase: string; detail?: string };

export type Onboarding = {
  approved: boolean;
  dismissed: boolean;
  steps: OnboardStep[];
  done: number;
  total: number;
  currentId: string | null;
  projectId: string | null;
  projectName: string | null;
  ideaId: string | null;
  idea: OnboardIdea | null;
  // Every idea of the project (newest first), so a user who imported a backlog can pick where to start.
  ideas: OnboardIdea[];
  contextLength: number;
  shipped: boolean;
};

// Used by the app layout: who gets bounced to /welcome.
export function needsWelcome(a: { approved: boolean; owner: boolean; projectCount: number; dismissed: boolean }): boolean {
  if (!a.approved && !a.owner) return true;
  if (a.dismissed) return false;
  return a.projectCount === 0;
}

// Enough to ground an estimate; shorter than this is treated as "not written yet".
export const MIN_CONTEXT_CHARS = 120;

export async function getOnboarding(
  userId: string,
  email: string | null | undefined,
  opts: { gh?: GitHubApi; quick?: boolean } = {}
): Promise<Onboarding> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { approved: true, onboardingDismissed: true } });
  const owner = await isOwner(userId, email);
  const approved = !!user && (owner || user.approved);
  // Someone who is not approved yet never causes GitHub requests, whatever the caller asked for.
  const quick = opts.quick || !approved;
  const dismissed = !!user?.onboardingDismissed;

  const projects = await db.project.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const merged = new Set(
    (await db.run.findMany({ where: { userId, kind: "implement", status: "merged" } })).map((r) => r.projectId)
  );
  // Work on the first project that has not shipped yet; else the latest.
  const project = projects.find((p) => !merged.has(p.id)) ?? projects[projects.length - 1] ?? null;

  const steps: OnboardStep[] = [];
  const add = (id: string, title: string, phase: string, status: OnboardStatus, detail?: string) =>
    steps.push({ id, title, phase, status, detail });
  const prevDone = () => steps.every((s) => s.status === "done");
  const gate = (ok: boolean): OnboardStatus => (ok ? "todo" : "blocked");

  add("approval", "Get approved", "Welcome", approved ? "done" : "todo",
    approved ? undefined : "The owner has to approve your account before you can use Idea HQ. Nothing else is needed from you.");
  add("project", "Create your first project", "Welcome", project ? "done" : gate(prevDone()), project?.name);

  let setupSteps: { id: string; title: string; status: OnboardStatus; detail?: string }[] = [];
  if (project && approved) {
    const st = await getSetupStatus(userId, project.id, { gh: opts.gh, quick });
    setupSteps = st.steps.filter((s) => s.id !== "practice");
  }
  for (const id of ["github", "repo", "commands", "workflow", "secret"]) {
    const s = setupSteps.find((x) => x.id === id);
    const titles: Record<string, string> = {
      github: "Connect GitHub", repo: "Choose the repo and branch", commands: "Set build and test commands",
      workflow: "Install the Idea HQ workflow", secret: "Add your Anthropic API key to the repo",
    };
    add(id, titles[id], "Connect your repo", s ? s.status : "blocked", s?.detail);
  }

  const ctxLen = (project?.context || "").trim().length;
  add("context", "Teach the AI about your project", "Teach the AI", ctxLen >= MIN_CONTEXT_CHARS ? "done" : gate(prevDone()),
    ctxLen >= MIN_CONTEXT_CHARS ? undefined : "A short description of what the project is and how it is built. The AI can draft it from your repo.");

  let idea: OnboardIdea | null = null;
  let allIdeas: OnboardIdea[] = [];
  let runs: { status: string; prNumber: number | null; ideaId: string | null }[] = [];
  if (project) {
    const ideas = await db.idea.findMany({ where: { userId, projectId: project.id }, orderBy: { createdAt: "desc" } });
    runs = await db.run.findMany({ where: { userId, projectId: project.id, kind: "implement" } });
    allIdeas = ideas.filter((i) => i.status !== "done").slice(0, 40).map(toOnboardIdea);
    const withRun = ideas.find((i) => runs.some((r) => r.ideaId === i.id));
    const pick = withRun ?? ideas.find((i) => i.status !== "done") ?? ideas[0];
    if (pick) idea = toOnboardIdea(pick);
  }
  const ideaRuns = idea ? runs.filter((r) => r.ideaId === idea!.id) : [];

  add("idea", "Add your first idea", "Your first AI change", idea ? "done" : gate(prevDone()), idea?.title);
  add("plan", "Plan the idea", "Your first AI change", idea?.plan ? "done" : gate(prevDone()),
    idea?.plan ? undefined : "The AI sizes your idea and writes a precise plan you can read before anything is built.");
  const ran = ideaRuns.some((r) => r.prNumber);
  add("run", "Build it with AI", "Your first AI change", ran ? "done" : ideaRuns.some((r) => r.status === "failed") ? "warn" : gate(prevDone()));
  const shipped = ideaRuns.some((r) => r.status === "merged");
  add("shipped", "Review and merge the change", "Your first AI change", shipped ? "done" : gate(prevDone()));

  const done = steps.filter((s) => s.status === "done").length;
  const current = steps.find((s) => s.status !== "done");
  return {
    approved, dismissed, steps, done, total: steps.length, currentId: current ? current.id : null,
    projectId: project?.id ?? null, projectName: project?.name ?? null,
    ideaId: idea?.id ?? null, idea, ideas: allIdeas, contextLength: ctxLen, shipped,
  };
}
