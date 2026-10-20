import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import { WORKFLOW_VERSION } from "@/lib/runs/workflow";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));

import { getSetupStatus, suggestCommands } from "@/lib/runs/setup";
import { clearSetupCache } from "@/lib/runs/setup-cache";
import { GitHubRateLimitError } from "@/lib/github/client";

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
  clearSetupCache();
  for (const k of Object.keys(state)) delete state[k];
});

describe("getSetupStatus", () => {
  it("starts at step 1 with everything after it blocked", async () => {
    t.tables.project.push(proj());
    const s = await getSetupStatus("u1", "p1", { gh, fresh: true });
    expect(ids(s)).toEqual({ github: "todo", repo: "blocked", commands: "blocked", workflow: "blocked", secret: "blocked", practice: "blocked" });
    expect(s.currentId).toBe("github");
    expect(s.done).toBe(0);
  });

  it("moves forward as the real world changes", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj());
    expect(ids(await getSetupStatus("u1", "p1", { gh, fresh: true })).repo).toBe("todo");
    Object.assign(t.tables.project[0], ready);
    expect(ids(await getSetupStatus("u1", "p1", { gh, fresh: true })).commands).toBe("todo");
    t.tables.project[0].commandsConfirmed = true;
    expect(ids(await getSetupStatus("u1", "p1", { gh, fresh: true })).workflow).toBe("todo");
    state.workflow = true;
    const s = await getSetupStatus("u1", "p1", { gh, fresh: true });
    expect(ids(s)).toMatchObject({ workflow: "done", secret: "todo", practice: "blocked" });
    state.secret = true;
    expect(ids(await getSetupStatus("u1", "p1", { gh, fresh: true }))).toMatchObject({ secret: "done", practice: "todo" });
  });

  it("flags an outdated workflow and links the open setup PR", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, setupPrNumber: 3 }));
    state.workflow = true; state.workflowContent = "name: old";
    const s = await getSetupStatus("u1", "p1", { gh, fresh: true });
    expect(s.steps.find((x) => x.id === "workflow")).toMatchObject({ status: "warn" });
    state.workflow = false;
    const s2 = await getSetupStatus("u1", "p1", { gh, fresh: true });
    expect(s2.steps.find((x) => x.id === "workflow")?.url).toBe("https://github.com/acme/app/pull/3");
  });

  describe("an optional workflow update", () => {
    const older = `# idea-hq-workflow-version: 5\nname: Idea HQ`; // (6 was published broken and counts as no workflow)
    const withPr = (pr: { number: number; state: string } | null) => ({ ...gh, getPr: async () => { if (!pr) throw new Error("gone"); return pr; } });
    beforeEach(() => {
      t.tables.githubInstallation.push({ userId: "u1", id: 5 });
      t.tables.project.push(proj({ ...ready, commandsConfirmed: true, workflowInstalled: true, setupPrNumber: 9 }));
      state.workflow = true;
      state.secret = true;
      state.workflowContent = older;
    });
    it("is offered, never blocking, when the installed workflow works but is older", async () => {
      const s = await getSetupStatus("u1", "p1", { gh: withPr(null), fresh: true });
      expect(s.workflowUpdateAvailable).toBe(true);
      expect(ids(s).workflow).toBe("done");
      expect(t.tables.project[0].workflowVersionSeen).toBe(5);
    });
    it("links the pull request when the update is already waiting on GitHub", async () => {
      const s = await getSetupStatus("u1", "p1", { gh: withPr({ number: 9, state: "open" }), fresh: true });
      expect(s.updatePrUrl).toBe("https://github.com/acme/app/pull/9");
    });
    it("does not link a pull request that is merged, closed or gone", async () => {
      expect((await getSetupStatus("u1", "p1", { gh: withPr({ number: 9, state: "closed" }), fresh: true })).updatePrUrl).toBeNull();
      clearSetupCache();
      expect((await getSetupStatus("u1", "p1", { gh: withPr(null), fresh: true })).updatePrUrl).toBeNull();
    });
    it("is not offered once the newest workflow is installed", async () => {
      state.workflowContent = `# idea-hq-workflow-version: ${WORKFLOW_VERSION}\nname: Idea HQ`;
      const s = await getSetupStatus("u1", "p1", { gh: withPr({ number: 9, state: "open" }), fresh: true });
      expect(s.workflowUpdateAvailable).toBe(false);
      expect(s.updatePrUrl).toBeNull();
    });
  });

  it("marks practice done only after a merged implement run", async () => {
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, workflowInstalled: true }));
    state.workflow = true; state.secret = true;
    t.tables.run.push({ id: "r1", projectId: "p1", userId: "u1", kind: "implement", status: "pr_open" });
    expect(ids(await getSetupStatus("u1", "p1", { gh, fresh: true })).practice).toBe("warn");
    t.tables.run[0].status = "merged";
    const s = await getSetupStatus("u1", "p1", { gh, fresh: true });
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
    const s = await getSetupStatus("u1", "p1", { gh, fresh: true });
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

describe("GitHub request budget", () => {
  const counting = () => {
    const c = { files: 0, secrets: 0 };
    const g = {
      getFile: async (_i: number, _o: string, _r: string, path: string) => { c.files += 1; return path === "package.json" ? null : { sha: "w", content: `# idea-hq-workflow-version: ${WORKFLOW_VERSION}` }; },
      secretExists: async () => { c.secrets += 1; return true; },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { c, g };
  };
  const setup = (over: Record<string, any> = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    t.tables.githubInstallation.push({ userId: "u1", id: 5 });
    t.tables.project.push(proj({ ...ready, commandsConfirmed: true, ...over }));
  };

  it("quick mode makes no GitHub request and answers from what the last full check stored", async () => {
    setup({ workflowInstalled: true, secretConfirmed: true });
    const { c, g } = counting();
    const s = await getSetupStatus("u1", "p1", { quick: true, gh: g });
    expect(c).toEqual({ files: 0, secrets: 0 });
    expect(ids(s)).toMatchObject({ workflow: "done", secret: "done" });
  });

  it("a full check stores what it saw, so the next quick poll agrees", async () => {
    setup();
    const { g } = counting();
    await getSetupStatus("u1", "p1", { gh: g, fresh: true });
    expect(t.tables.project[0]).toMatchObject({ workflowInstalled: true, secretConfirmed: true });
    const quick = await getSetupStatus("u1", "p1", { quick: true, gh: { getFile: async () => { throw new Error("no"); } } as any }); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ids(quick)).toMatchObject({ workflow: "done", secret: "done" });
  });

  it("shares one full check between callers for 30 seconds, and fresh bypasses it", async () => {
    setup();
    const { c, g } = counting();
    let clock = 1_000;
    const opts = { gh: g, now: () => clock };
    await getSetupStatus("u1", "p1", opts);
    const after1 = c.files + c.secrets;
    await getSetupStatus("u1", "p1", opts);
    clock += 10_000;
    await getSetupStatus("u1", "p1", opts);
    expect(c.files + c.secrets).toBe(after1);
    clock += 31_000;
    await getSetupStatus("u1", "p1", opts);
    expect(c.files + c.secrets).toBe(after1 * 2);
    await getSetupStatus("u1", "p1", { ...opts, fresh: true });
    expect(c.files + c.secrets).toBe(after1 * 3);
  });

  it("does not fetch package.json once the commands are confirmed", async () => {
    setup();
    const paths: string[] = [];
    const g = { getFile: async (_i: number, _o: string, _r: string, p: string) => { paths.push(p); return null; }, secretExists: async () => false } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    await getSetupStatus("u1", "p1", { gh: g, fresh: true });
    expect(paths).not.toContain("package.json");
  });

  it("a GitHub rate limit surfaces instead of looking like a broken setup", async () => {
    setup();
    const g = { getFile: async () => { throw new GitHubRateLimitError("slow down", 600); }, secretExists: async () => true } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(getSetupStatus("u1", "p1", { gh: g, fresh: true })).rejects.toBeInstanceOf(GitHubRateLimitError);
  });
});
