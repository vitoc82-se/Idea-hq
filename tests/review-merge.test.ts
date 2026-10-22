import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// At Review the owner sees what the pull request changes; the route reads it from GitHub once per version of the PR.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
const gh = vi.hoisted(() => ({
  calls: 0,
  changes: null as null | { files: { name: string; additions: number; deletions: number }[]; totalFiles: number; additions: number; deletions: number; truncated: boolean },
  fail: false,
}));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
vi.mock("@/lib/github/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/client")>()),
  github: {
    prChanges: async () => { gh.calls++; if (gh.fail) throw new Error("down"); return gh.changes; },
    checkSummary: async () => ({ state: "green", failing: [] }),
  },
}));
vi.mock("@/lib/runs/engine", async (orig) => ({ ...(await orig<typeof import("@/lib/runs/engine")>()), reconcileRun: async () => undefined }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { GET as getRuns } from "@/app/api/ideas/[id]/runs/route";
import { sizeExpectation, sizeOptionLabel } from "@/lib/runs/sizes";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const get = async () => (await getRuns(new Request("https://x/api/ideas/i1/runs?poll=1"), { params: Promise.resolve({ id: "i1" }) })).json() as Promise<{ changes: null | { files: { name: string; additions: number; deletions: number }[]; more: number; totalFiles: number; additions: number; deletions: number; truncated: boolean } }>;
const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `src/f${i}.ts`, additions: i + 1, deletions: i }));

beforeEach(async () => {
  await resetDb();
  gh.calls = 0; gh.fail = false;
  gh.changes = { files: files(9), totalFiles: 9, additions: 45, deletions: 36, truncated: false };
  sess.user = { id: "ann", email: "ann@x.se" };
  await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
  await db.githubInstallation.create({ data: { userId: "ann", id: 5, repos: ["acme/app"] } });
  await db.project.create({ data: { id: "p1", userId: "ann", name: "P", slug: "p", context: "", installationId: 5, repoOwner: "acme", repoName: "app" } });
  await db.idea.create({ data: { id: "i1", userId: "ann", projectId: "p1", title: "T", complexity: "S", plan: "P" } });
});
// The route remembers what it read for each version of a pull request (its run id and head), so every test gets its own.
let version = 0;
const openRun = (over: Record<string, unknown> = {}) => db.run.create({ data: { id: "r1", userId: "ann", projectId: "p1", ideaId: "i1", kind: "implement", status: "pr_open", prNumber: 7, headSha: `sha-${++version}`, checksState: "green", ...over } });

describe("what the pull request changes, for the review", () => {
  it("lists the biggest files first, says how many more there are, and the totals", async () => {
    await openRun();
    const { changes } = await get();
    expect(changes).toMatchObject({ totalFiles: 9, more: 3, additions: 45, deletions: 36, truncated: false });
    expect(changes!.files).toHaveLength(6);
    expect(changes!.files[0].name).toBe("src/f8.ts"); // 9 + 8 lines
    const sizes = changes!.files.map((f) => f.additions + f.deletions);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("asks GitHub once per version of the pull request, not on every refresh, and again after a revision", async () => {
    await openRun();
    await get(); await get(); await get();
    expect(gh.calls).toBe(1);
    await db.run.update({ where: { id: "r1" }, data: { headSha: `sha-after-${version}` } });
    await get();
    expect(gh.calls).toBe(2);
  });

  it("has nothing to show before a pull request is open or after it is merged", async () => {
    expect((await get()).changes).toBeNull();
    await openRun({ status: "merged" });
    expect((await get()).changes).toBeNull();
    expect(gh.calls).toBe(0);
  });

  it("does not ask GitHub for a repository the person cannot open", async () => {
    await db.githubInstallation.update({ where: { userId_id: { userId: "ann", id: 5 } }, data: { repos: ["acme/other"] } });
    await openRun();
    const body = await get();
    expect(body.changes).toBeNull();
    expect(gh.calls).toBe(0);
  });

  it("the card still loads when GitHub cannot be asked", async () => {
    gh.fail = true;
    await openRun();
    expect((await get()).changes).toBeNull();
  });

  it("an empty pull request says nothing, and a huge one is marked as more than shown", async () => {
    gh.changes = { files: [], totalFiles: 0, additions: 0, deletions: 0, truncated: false };
    await openRun();
    expect((await get()).changes).toMatchObject({ totalFiles: 0, files: [], more: 0 });
    await db.run.update({ where: { id: "r1" }, data: { headSha: `sha-big-${version}` } });
    gh.changes = { files: files(100), totalFiles: 100, additions: 5050, deletions: 4950, truncated: true };
    expect((await get()).changes).toMatchObject({ totalFiles: 100, more: 94, truncated: true });
  });
});

describe("the card at Review and Ship", () => {
  const card = read("src/app/(app)/ideas/idea-journey.tsx");
  it("shows what changed with the line counts and a link to every line", () => {
    expect(card).toMatch(/data-testid="what-changed"/);
    expect(card).toMatch(/What changed: \{data\.changes\.totalFiles\}/);
    expect(card).toMatch(/see every line on GitHub/);
    expect(card).toMatch(/\$\{prUrl\}\/files/);
  });
  it("says what Merge does and that it can be undone, only when the button is Merge", () => {
    expect(card).toMatch(/view\.primary\?\.action === "merge" && run && \(/);
    expect(card).toMatch(/Merge puts this change into/);
    expect(card).toMatch(/You can undo it afterwards with Revert this change/);
  });
  it("offers Revert at Ship, in three states, and brings the revert into view", () => {
    expect(card).toMatch(/Changed your mind\?/);
    expect(card).toMatch(/Revert this change opens a new pull request that undoes it\. Nothing is undone until you merge that one\./);
    expect(card).toMatch(/A revert is waiting for you/);
    expect(card).toMatch(/This change was reverted\./);
    expect(card).toMatch(/allowAdjust && run\?\.status === "merged" && run\.kind === "implement"/); // not on the welcome pages
    expect(card).toMatch(/if \(revealed\) onReveal\("implement-with-ai"\)/);
  });
  it("a closed, cancelled or failed revert can be tried again", () => {
    expect(card).toMatch(/\["closed", "cancelled", "failed"\]\.includes\(revert\.status\)/);
  });
});

describe("sizes lead with minutes and cost", () => {
  const card = read("src/app/(app)/ideas/idea-journey.tsx");
  it("the size texts and the dropdown say minutes and cost, never turns", () => {
    for (const c of ["S", "M", "L"] as const) {
      expect(sizeExpectation(c)).not.toMatch(/turn/);
      expect(sizeOptionLabel(c)).not.toMatch(/turn/);
      expect(sizeOptionLabel(c)).toMatch(/minutes$/);
    }
  });
  it("the card no longer prints the model, effort or turn limit; they are under Adjust", () => {
    expect(card).not.toMatch(/It will use|limit of \$\{|\$\{run\.turns\}|an unknown number of turns/);
    expect(card).toMatch(/The model, effort and turn limit are under Adjust model and turns\./);
  });
  it("the finished and review lines say minutes and cost, not turns", () => {
    expect(card).toMatch(/This took \{\[minutesText/);
    expect(card).not.toMatch(/\$\{run\.turns\}/);
  });
  it("the run's workflow time reaches the card", () => {
    expect(read("src/app/api/ideas/[id]/runs/route.ts")).toMatch(/costUsd: true, stageMs: true/);
  });
});
