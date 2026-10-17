import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import { WORKFLOW_VERSION } from "@/lib/runs/workflow";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));

import { getSetupStatus, suggestCommands } from "@/lib/runs/setup";

let t: ReturnType<typeof makeFakeDb>;
const state: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const gh = {
  getFile: async (_i: number, _o: string, _r: string, path: string) => {
    if (path === "package.json") return state.pkg ? { sha: "p", content: state.pkg } : null;
    return state.workflow ? { sha: "w", content: state.workflowContent ?? `# idea-hq-workflow-version: ${WORKFLOW_VERSION}` } : null;
  },
  secretExists: async () => !!state.secret,
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const proj = (over: Record<string, any> = {}) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: "p1", userId: "u1", name: "P", installationId: null, repoOwner: null, repoName: null, envBranches: null,
  defaultEnv: null, workflowInstalled: false, commandsConfirmed: false, setupPrNumber: null, ...over,
});
const ready = { installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { live: "main" }, defaultEnv: "live" };
const ids = (s: Awaited<ReturnType<typeof getSetupStatus>>) => Object.fromEntries(s.steps.map((x) => [x.id, x.status]));

beforeEach(() => {
  t = makeFakeDb(); holder.db = t.db;
  for (const k of Object.keys(state)) delete state[k];
});

describe("getSetupStatus", () => {
  it("starts at step 1 with everything after it blocked", async () => {
    t.tables.project.push(proj());
    const s = await getSetupStatus("u1", "p1", { gh });
    expect(ids(s)).toEqual({ github: "todo", repo: "blocked", commands: "blocked", workflow: "blocked", secret: "blocked", practice: "blocked" });
    expect(s.currentId).toBe("github");
    expect(s.done).toBe(0);
  });

  it("moves forward as the real world changes", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj());
    expect(ids(await getSetupStatus("u1", "p1", { gh })).repo).toBe("todo");
    Object.assign(t.tables.project[0], ready);
    expect(ids(await getSetupStatus("u1", "p1", { gh })).commands).toBe("todo");
    t.tables.project[0].commandsConfirmed = true;
    expect(ids(await getSetupStatus("u1", "p1", { gh })).workflow).toBe("todo");
    state.workflow = true;
    const s = await getSetupStatus("u1", "p1", { gh });
    expect(ids(s)).toMatchObject({ workflow: "done", secret: "todo", practice: "blocked" });
    state.secret = true;
    expect(ids(await getSetupStatus("u1", "p1", { gh }))).toMatchObject({ secret: "done", practice: "todo" });
  });

  it("flags an outdated workflow and links the open setup PR", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, setupPrNumber: 3 }));
    state.workflow = true; state.workflowContent = "name: old";
    const s = await getSetupStatus("u1", "p1", { gh });
    expect(s.steps.find((x) => x.id === "workflow")).toMatchObject({ status: "warn" });
    state.workflow = false;
    const s2 = await getSetupStatus("u1", "p1", { gh });
    expect(s2.steps.find((x) => x.id === "workflow")?.url).toBe("https://github.com/acme/app/pull/3");
  });

  it("marks practice done only after a merged implement run", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, workflowInstalled: true }));
    state.workflow = true; state.secret = true;
    t.tables.run.push({ id: "r1", projectId: "p1", userId: "u1", kind: "implement", status: "pr_open" });
    expect(ids(await getSetupStatus("u1", "p1", { gh })).practice).toBe("warn");
    t.tables.run[0].status = "merged";
    const s = await getSetupStatus("u1", "p1", { gh });
    expect(ids(s).practice).toBe("done");
    expect(s.done).toBe(6);
    expect(s.currentId).toBeNull();
  });

  it("quick mode makes no GitHub calls", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, workflowInstalled: true }));
    const boom = { getFile: async () => { throw new Error("no github in quick mode"); }, secretExists: async () => { throw new Error("no"); } } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = await getSetupStatus("u1", "p1", { quick: true, gh: boom });
    expect(ids(s).workflow).toBe("done");
  });

  it("lists the user's other connected repos for the multi-repo key command", async () => {
    t.tables.project.push(proj({ ...ready }), proj({ id: "p2", repoOwner: "acme", repoName: "other" }), proj({ id: "p3", userId: "u2", repoOwner: "x", repoName: "y" }));
    const s = await getSetupStatus("u1", "p1", { gh });
    expect(s.otherRepos).toEqual(["acme/other"]);
  });

  it("is not available for another user's project", async () => {
    t.tables.project.push(proj());
    await expect(getSetupStatus("u2", "p1", { gh })).rejects.toMatchObject({ status: 404 });
  });
});

describe("suggestCommands", () => {
  it("prefers a typecheck script and skips the npm placeholder test", () => {
    expect(suggestCommands(JSON.stringify({ scripts: { typecheck: "tsc", build: "next build", test: "vitest run" } }))).toEqual({ build: "npm run typecheck", test: "npm test" });
    expect(suggestCommands(JSON.stringify({ scripts: { build: "next build", test: 'echo "Error: no test specified" && exit 1' } }))).toEqual({ build: "npm run build", test: null });
    expect(suggestCommands("not json")).toEqual({ build: null, test: null });
    expect(suggestCommands(null)).toEqual({ build: null, test: null });
  });
});
