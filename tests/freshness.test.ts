import { describe, it, expect, vi, beforeEach } from "vitest";

// Is what Idea HQ knows about a project current? Knowledge versus the repo, and the installed
// workflow versus the newest, cached so the Projects page does not ask GitHub every time.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { refreshFreshness, isStale, workflowUpdateAvailable, STALE_COMMITS, FRESHNESS_TTL_MS } from "@/lib/freshness";
import { WORKFLOW_VERSION } from "@/lib/runs/workflow";
import { GET as listProjects } from "@/app/api/projects/route";
import type { GitHubApi } from "@/lib/github/client";

const NOW = new Date("2026-10-20T12:00:00Z");
let calls: string[];
function fakeGh(over: Partial<{ behind: number | null; wfVersion: number | null; throwAt: string }> = {}): GitHubApi {
  const o = { behind: 7, wfVersion: 4, ...over };
  return {
    getFile: async () => {
      calls.push("getFile");
      if (o.throwAt === "getFile") throw new Error("down");
      return o.wfVersion === null ? null : { sha: "w", content: `# idea-hq-workflow-version: ${o.wfVersion}\nname: Idea HQ` };
    },
    commitsAhead: async () => {
      calls.push("commitsAhead");
      if (o.throwAt === "commitsAhead") throw new Error("down");
      return o.behind;
    },
  } as unknown as GitHubApi;
}

beforeEach(async () => {
  await resetDb();
  calls = [];
  process.env.OWNER_EMAIL = "boss@x.se";
  sess.user = { id: "u1", email: "ann@x.se" };
  await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
  await db.project.create({
    data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "", installationId: 9, repoOwner: "ann", repoName: "shop", envBranches: { live: "main" }, defaultEnv: "live", knowledge: { learnedSha: "abc123", sections: {} } },
  });
  await db.project.create({ data: { id: "p2", userId: "u1", name: "NoRepo", slug: "norepo", context: "" } });
});

describe("the rules", () => {
  it("asks about a rescan from the threshold on, not before, and never without a number", () => {
    expect(isStale(STALE_COMMITS - 1)).toBe(false);
    expect(isStale(STALE_COMMITS)).toBe(true);
    expect(isStale(null)).toBe(false);
    expect(isStale(undefined)).toBe(false);
  });
  it("offers a workflow update only when the installed one still works but is older than the newest", () => {
    expect(workflowUpdateAvailable(4, "claude")).toBe(true);
    expect(workflowUpdateAvailable(3, "claude")).toBe(true); // v3 still works for Claude
    expect(workflowUpdateAvailable(WORKFLOW_VERSION, "claude")).toBe(false);
    expect(workflowUpdateAvailable(null, "claude")).toBe(false);
    expect(workflowUpdateAvailable(3, "openai")).toBe(false); // too old to work: that is the forced "outdated" case, not an optional update
    expect(workflowUpdateAvailable(4, "openai")).toBe(true);
  });
});

describe("refreshFreshness", () => {
  it("reads how far behind the knowledge is and which workflow is installed, and stores it", async () => {
    const f = await refreshFreshness("u1", "p1", { gh: fakeGh({ behind: 31, wfVersion: 4 }), now: NOW });
    expect(f).toEqual({ knowledgeBehind: 31, workflowVersionSeen: 4, checkedAt: NOW.toISOString() });
    expect(await db.project.findUnique({ where: { id: "p1" } })).toMatchObject({ knowledgeBehind: 31, workflowVersionSeen: 4, freshnessCheckedAt: NOW });
  });
  it("does not ask GitHub again within the hour, but does after it or when forced", async () => {
    await refreshFreshness("u1", "p1", { gh: fakeGh(), now: NOW });
    calls = [];
    await refreshFreshness("u1", "p1", { gh: fakeGh(), now: new Date(NOW.getTime() + FRESHNESS_TTL_MS - 1000) });
    expect(calls).toEqual([]);
    await refreshFreshness("u1", "p1", { gh: fakeGh(), now: new Date(NOW.getTime() + FRESHNESS_TTL_MS + 1000) });
    expect(calls).toEqual(["getFile", "commitsAhead"]);
    calls = [];
    await refreshFreshness("u1", "p1", { gh: fakeGh(), now: new Date(NOW.getTime() + FRESHNESS_TTL_MS + 2000), force: true });
    expect(calls).toEqual(["getFile", "commitsAhead"]);
  });
  it("a project that was never scanned has no 'behind' number, and one without a repo is left alone", async () => {
    await db.project.update({ where: { id: "p1" }, data: { knowledge: { sections: {} } } });
    const f = await refreshFreshness("u1", "p1", { gh: fakeGh(), now: NOW });
    expect(f?.knowledgeBehind).toBeNull();
    expect(calls).not.toContain("commitsAhead");
    calls = [];
    expect(await refreshFreshness("u1", "p2", { gh: fakeGh(), now: NOW })).toMatchObject({ knowledgeBehind: null, checkedAt: null });
    expect(calls).toEqual([]);
  });
  it("a GitHub error keeps the last known numbers and leaves the project unchecked, so the next look tries again", async () => {
    await db.project.update({ where: { id: "p1" }, data: { knowledgeBehind: 12, workflowVersionSeen: 5 } });
    for (const throwAt of ["getFile", "commitsAhead"]) {
      const f = await refreshFreshness("u1", "p1", { gh: fakeGh({ throwAt }), now: NOW });
      expect(f).toEqual({ knowledgeBehind: 12, workflowVersionSeen: 5, checkedAt: null });
    }
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.freshnessCheckedAt).toBeNull();
  });
  it("a repo with no workflow file records 'none', and an unknown distance is stored as unknown", async () => {
    const f = await refreshFreshness("u1", "p1", { gh: fakeGh({ wfVersion: null, behind: null }), now: NOW });
    expect(f).toEqual({ knowledgeBehind: null, workflowVersionSeen: null, checkedAt: NOW.toISOString() });
  });
  it("only for the person's own project", async () => {
    await db.user.create({ data: { id: "u2", email: "bob@x.se", approved: true } });
    expect(await refreshFreshness("u2", "p1", { gh: fakeGh(), now: NOW })).toBeNull();
  });
});

describe("the project list", () => {
  it("carries the cached flags so the page can show them without asking GitHub", async () => {
    await db.project.update({ where: { id: "p1" }, data: { knowledgeBehind: 25, workflowVersionSeen: 4 } });
    const rows = await (await listProjects()).json();
    const p1 = rows.find((r: { id: string }) => r.id === "p1");
    expect(p1.freshness).toEqual({ behind: 25, stale: true, workflowUpdate: true });
    const p2 = rows.find((r: { id: string }) => r.id === "p2");
    expect(p2.freshness).toEqual({ behind: null, stale: false, workflowUpdate: false });
  });
});
