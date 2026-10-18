import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import { WORKFLOW_VERSION } from "@/lib/runs/workflow";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));

import { getOnboarding, needsWelcome, MIN_CONTEXT_CHARS } from "@/lib/onboarding";
import { clearSetupCache } from "@/lib/runs/setup-cache";

let t: ReturnType<typeof makeFakeDb>;
const state: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const gh = {
  getFile: async (_i: number, _o: string, _r: string, path: string) => {
    if (path === "package.json") return state.pkg ? { sha: "p", content: state.pkg } : null;
    if (path === "README.md") return state.readme ? { sha: "r", content: state.readme } : null;
    return state.workflow ? { sha: "w", content: `# idea-hq-workflow-version: ${WORKFLOW_VERSION}` } : null;
  },
  secretExists: async () => !!state.secret,
  listDir: async (_i: number, _o: string, _r: string, path: string) => (path === "" ? ["src/", "README.md"] : path === "src" ? ["app/", "lib/"] : ["page.tsx"]),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const ids = (o: Awaited<ReturnType<typeof getOnboarding>>) => Object.fromEntries(o.steps.map((s) => [s.id, s.status]));
const BASE = { installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { live: "main" }, defaultEnv: "live", commandsConfirmed: true, workflowInstalled: true };

beforeEach(() => {
  t = makeFakeDb(); holder.db = t.db;
  clearSetupCache();
  for (const k of Object.keys(state)) delete state[k];
  process.env.OWNER_EMAIL = "owner@x.se";
  t.tables.user.push({ id: "owner", email: "owner@x.se", approved: true }, { id: "u1", email: "f@x.se", approved: false });
});

describe("needsWelcome", () => {
  it("sends unapproved users to the welcome page always", () => {
    expect(needsWelcome({ approved: false, owner: false, projectCount: 5, dismissed: true })).toBe(true);
  });
  it("sends approved users with no project, unless they skipped", () => {
    expect(needsWelcome({ approved: true, owner: false, projectCount: 0, dismissed: false })).toBe(true);
    expect(needsWelcome({ approved: true, owner: false, projectCount: 0, dismissed: true })).toBe(false);
  });
  it("leaves existing users with projects alone", () => {
    expect(needsWelcome({ approved: true, owner: false, projectCount: 2, dismissed: false })).toBe(false);
    expect(needsWelcome({ approved: false, owner: true, projectCount: 1, dismissed: false })).toBe(false);
  });
});

describe("getOnboarding", () => {
  it("unapproved: only the approval step is open, nothing else can be done", async () => {
    const o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.approved).toBe(false);
    expect(o.currentId).toBe("approval");
    expect(Object.values(ids(o)).filter((s) => s === "done")).toHaveLength(0);
  });

  it("approved with no project: next is creating the project", async () => {
    t.tables.user[1].approved = true;
    const o = await getOnboarding("u1", "f@x.se", { gh });
    expect(ids(o)).toMatchObject({ approval: "done", project: "todo", github: "blocked", context: "blocked" });
    expect(o.currentId).toBe("project");
  });

  it("walks through repo setup, context, idea, plan, run and shipped", async () => {
    t.tables.user[1].approved = true;
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push({ id: "p1", userId: "u1", name: "Shop", context: "", createdAt: new Date(1), ...BASE });
    state.workflow = true; state.secret = true;

    let o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.currentId).toBe("context");
    expect(ids(o)).toMatchObject({ project: "done", github: "done", secret: "done", idea: "blocked" });

    t.tables.project[0].context = "x".repeat(MIN_CONTEXT_CHARS);
    o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.currentId).toBe("idea");

    t.tables.idea.push({ id: "i1", userId: "u1", projectId: "p1", title: "Dark mode", plan: null, createdAt: new Date(2) });
    o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.currentId).toBe("plan");
    expect(o.idea?.title).toBe("Dark mode");

    t.tables.idea[0].plan = "PLAN";
    o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.currentId).toBe("run");

    t.tables.run.push({ id: "r1", userId: "u1", projectId: "p1", ideaId: "i1", kind: "implement", status: "pr_open", prNumber: 4 });
    o = await getOnboarding("u1", "f@x.se", { gh });
    expect(ids(o)).toMatchObject({ run: "done", shipped: "todo" });
    expect(o.shipped).toBe(false);

    t.tables.run[0].status = "merged";
    o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.shipped).toBe(true);
    expect(o.done).toBe(o.total);
    expect(o.currentId).toBeNull();
  });

  it("flags a failed run so the user can retry", async () => {
    t.tables.user[1].approved = true;
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push({ id: "p1", userId: "u1", name: "Shop", context: "x".repeat(200), createdAt: new Date(1), ...BASE });
    t.tables.idea.push({ id: "i1", userId: "u1", projectId: "p1", title: "T", plan: "P", createdAt: new Date(2) });
    t.tables.run.push({ id: "r1", userId: "u1", projectId: "p1", ideaId: "i1", kind: "implement", status: "failed", prNumber: null });
    state.workflow = true; state.secret = true;
    expect(ids(await getOnboarding("u1", "f@x.se", { gh })).run).toBe("warn");
  });

  it("never mixes in another user's project", async () => {
    t.tables.user[1].approved = true;
    t.tables.project.push({ id: "px", userId: "someone-else", name: "Not mine", context: "", createdAt: new Date(1), ...BASE });
    const o = await getOnboarding("u1", "f@x.se", { gh });
    expect(o.projectId).toBeNull();
  });
});

