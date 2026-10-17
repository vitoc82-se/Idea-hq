import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import type { GitHubApi } from "@/lib/github/client";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }),
}));

import {
  startRun, approveRun, reviseRun, mergeRun, revertRun, cancelRun,
  handleWebhook, reconcileRun, openSetupPr, RunError, STUCK_AFTER_MS,
} from "@/lib/runs/engine";

let t: ReturnType<typeof makeFakeDb>;
let log: string[];
let gh: GitHubApi & { state: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

function fakeGh(): typeof gh {
  const state: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    branches: { main: { sha: "base1", protected: true }, "idea-hq/RUN1": { sha: "head1", protected: false } },
    secret: true, workflow: true, checks: { state: "green", failing: [] },
    pr: { number: 7, state: "open", merged: false, headSha: "head1", baseRef: "main", nodeId: "PRN", mergeCommitSha: null },
    dispatchError: null as Error | null, nextPr: 7, files: {},
  };
  const api: GitHubApi = {
    repoBranch: async (_i, _o, _r, b) => state.branches[b] ?? null,
    secretExists: async () => state.secret,
    fileExists: async () => state.workflow,
    createBranch: async (_i, _o, _r, b, sha) => { state.branches[b] = { sha, protected: false }; log.push(`createBranch ${b}`); },
    putFile: async (_i, _o, _r, p) => { log.push(`putFile ${p}`); },
    openPr: async (_i, _o, _r, p) => { log.push(`openPr ${p.head}->${p.base}`); return { number: state.nextPr }; },
    getPr: async () => state.pr,
    mergePr: async (_i, _o, _r, n, sha) => { log.push(`merge ${n}@${sha}`); return { sha: "merge1" }; },
    checkSummary: async () => state.checks,
    dispatchWorkflow: async (_i, _o, _r, f, ref, inputs) => {
      if (state.dispatchError) throw state.dispatchError;
      log.push(`dispatch ${f} ref=${ref} run=${inputs.run_id} branch=${inputs.branch}`);
      state.lastInputs = inputs;
    },
    revertPr: async () => { log.push("revertPr"); return { number: 9 }; },
    listRepos: async () => [],
    closePr: async (_i, _o, _r, n) => { log.push(`closePr ${n}`); },
  };
  return Object.assign(api, { state });
}

function seed(over: Record<string, any> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
  t.tables.user.push({ id: "u1" }, { id: "u2" });
  t.tables.project.push({
    id: "p1", userId: "u1", name: "Proj", installationId: 5, repoOwner: "Acme", repoName: "app",
    envBranches: { live: "main" }, defaultEnv: "live", autoMerge: false, workflowInstalled: true,
    buildCommand: null, testCommand: "npm test", ...over,
  });
  t.tables.idea.push({ id: "i1", userId: "u1", projectId: "p1", title: "Add dark mode", plan: "PLAN TEXT", status: "new", blockedBy: [] });
}

const deps = () => ({ gh });
const wfRun = (action: string, extra: Record<string, any> = {}) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  action, repository: { full_name: "acme/app" },
  workflow_run: { id: 99, display_title: "idea-hq RUN1", conclusion: null, html_url: "http://x", ...extra },
});

async function startedRun() {
  const run = await startRun("u1", "i1", deps());
  // Use a predictable id so the webhook title matches.
  t.tables.run[0].id = "RUN1";
  return run;
}
async function dispatchedRun() { await startedRun(); await approveRun("u1", "RUN1", deps()); }
async function prOpenRun() {
  await dispatchedRun();
  await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d-open", deps());
}

beforeEach(() => {
  t = makeFakeDb();
  holder.db = t.db;
  log = [];
  gh = fakeGh();
  seed();
});

describe("startRun", () => {
  it("needs a plan, a repo and an installed workflow", async () => {
    t.tables.idea[0].plan = null;
    await expect(startRun("u1", "i1", deps())).rejects.toMatchObject({ status: 409 });
    t.tables.idea[0].plan = "p";
    t.tables.project[0].workflowInstalled = false;
    await expect(startRun("u1", "i1", deps())).rejects.toThrow(/setup/i);
    t.tables.project[0].workflowInstalled = true;
    t.tables.project[0].installationId = null;
    await expect(startRun("u1", "i1", deps())).rejects.toThrow(/Connect a GitHub repo/);
  });

  it("is not available to another user's idea", async () => {
    await expect(startRun("u2", "i1", deps())).rejects.toMatchObject({ status: 404 });
  });

  it("is idempotent on double click", async () => {
    const a = await startRun("u1", "i1", deps());
    const b = await startRun("u1", "i1", deps());
    expect(b.id).toBe(a.id);
    expect(t.tables.run).toHaveLength(1);
  });

  it("is blocked by unfinished dependencies", async () => {
    t.tables.idea.push({ id: "i0", userId: "u1", projectId: "p1", title: "dep", status: "building", blockedBy: [] });
    t.tables.idea[0].blockedBy = ["i0"];
    await expect(startRun("u1", "i1", deps())).rejects.toThrow(/blocked/);
  });
});

describe("approveRun", () => {
  it("dispatches the workflow on the base branch and marks the idea building", async () => {
    await dispatchedRun();
    expect(log).toContain("dispatch idea-hq.yml ref=main run=RUN1 branch=idea-hq/RUN1");
    expect(t.tables.run[0].status).toBe("dispatched");
    expect(t.tables.idea[0].status).toBe("building");
    expect(gh.state.lastInputs.prompt).toContain("PLAN TEXT");
    expect(gh.state.lastInputs.prompt).toContain("Do NOT run git commit");
  });

  it("refuses when the API key secret or workflow file is missing", async () => {
    await startedRun();
    gh.state.secret = false;
    await expect(approveRun("u1", "RUN1", deps())).rejects.toThrow(/ANTHROPIC_API_KEY/);
    gh.state.secret = true; gh.state.workflow = false;
    await expect(approveRun("u1", "RUN1", deps())).rejects.toThrow(/setup PR/);
    expect(t.tables.run[0].status).toBe("awaiting_approval");
  });

  it("allows one executing run per project", async () => {
    await dispatchedRun();
    t.tables.idea.push({ id: "i2", userId: "u1", projectId: "p1", title: "Other", plan: "P2", status: "new", blockedBy: [] });
    const second = await startRun("u1", "i2", deps());
    await expect(approveRun("u1", second.id, deps())).rejects.toThrow(/already executing/);
  });

  it("cannot be approved twice", async () => {
    await dispatchedRun();
    await expect(approveRun("u1", "RUN1", deps())).rejects.toMatchObject({ status: 409 });
  });

  it("marks the run failed when GitHub refuses the dispatch", async () => {
    await startedRun();
    gh.state.dispatchError = new Error("403 forbidden");
    await expect(approveRun("u1", "RUN1", deps())).rejects.toMatchObject({ status: 502 });
    expect(t.tables.run[0].status).toBe("failed");
  });

  it("is not available to another user", async () => {
    await startedRun();
    await expect(approveRun("u2", "RUN1", deps())).rejects.toMatchObject({ status: 404 });
  });
});

describe("webhooks", () => {
  it("ignores a duplicate delivery", async () => {
    await dispatchedRun();
    expect(await handleWebhook("workflow_run", wfRun("in_progress"), "d1", deps())).toBe("running");
    expect(await handleWebhook("workflow_run", wfRun("in_progress"), "d1", deps())).toBe("duplicate");
  });

  it("forgets a delivery whose processing threw, so redelivery works", async () => {
    await dispatchedRun();
    gh.getPr = async () => { throw new Error("boom"); };
    // completed success + prNumber -> needs getPr; force the revision path
    t.tables.run[0].prNumber = 7;
    await expect(handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d2", deps())).rejects.toThrow("boom");
    expect(t.tables.webhookDelivery.find((d) => d.id === "d2")).toBeUndefined();
  });

  it("ignores a run id claimed from a different repo (cross-tenant spoof)", async () => {
    await dispatchedRun();
    const p = wfRun("in_progress"); p.repository.full_name = "evil/other";
    expect(await handleWebhook("workflow_run", p, "d3", deps())).toBe("ignored");
    expect(t.tables.run[0].status).toBe("dispatched");
  });

  it("moves dispatched -> running -> pr_open and opens the PR with the app", async () => {
    await dispatchedRun();
    await handleWebhook("workflow_run", wfRun("in_progress"), "d4", deps());
    expect(t.tables.run[0].status).toBe("running");
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d5", deps());
    expect(t.tables.run[0]).toMatchObject({ status: "pr_open", prNumber: 7, headSha: "head1" });
    expect(log).toContain("openPr idea-hq/RUN1->main");
  });

  it("handles completed arriving before in_progress", async () => {
    await dispatchedRun();
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d6", deps());
    await handleWebhook("workflow_run", wfRun("in_progress"), "d7", deps());
    expect(t.tables.run[0].status).toBe("pr_open");
  });

  it("fails the run when the workflow fails", async () => {
    await dispatchedRun();
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "failure" }), "d8", deps());
    expect(t.tables.run[0].status).toBe("failed");
    expect(t.tables.run[0].error).toMatch(/failure/);
  });

  it("fails the run when no branch was pushed or nothing changed", async () => {
    await dispatchedRun();
    delete gh.state.branches["idea-hq/RUN1"];
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d9", deps());
    expect(t.tables.run[0].error).toMatch(/pushed no branch/);
    t.tables.run[0].status = "dispatched"; t.tables.run[0].error = null;
    gh.state.branches["idea-hq/RUN1"] = { sha: "base1", protected: false };
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "d10", deps());
    expect(t.tables.run[0].error).toMatch(/no changes/);
  });

  it("records cost and turns from the idea-hq/run status", async () => {
    await prOpenRun();
    await handleWebhook("status", {
      repository: { full_name: "acme/app" }, context: "idea-hq/run", state: "success",
      description: "run=RUN1 cost=0.42 turns=12 failed=none",
    }, "d11", deps());
    expect(t.tables.run[0]).toMatchObject({ costUsd: 0.42, turns: 12 });
  });

  it("ignores statuses from other contexts and unknown events", async () => {
    await prOpenRun();
    expect(await handleWebhook("status", { repository: { full_name: "acme/app" }, context: "ci", description: "run=RUN1" }, "d12", deps())).toBe("ignored");
    expect(await handleWebhook("star", { repository: { full_name: "acme/app" } }, "d13", deps())).toBe("ignored");
  });

  it("records the check result when a check suite completes", async () => {
    await prOpenRun();
    gh.state.checks = { state: "red", failing: ["ci"] };
    await handleWebhook("check_suite", { action: "completed", repository: { full_name: "acme/app" }, check_suite: { pull_requests: [{ number: 7 }] } }, "d14", deps());
    expect(t.tables.run[0].checksState).toBe("red");
  });

  it("marks merged runs done with a closure note, and closed PRs closed", async () => {
    await prOpenRun();
    await handleWebhook("pull_request", { action: "closed", number: 7, repository: { full_name: "acme/app" }, pull_request: { number: 7, merged: true, merge_commit_sha: "m1" } }, "d15", deps());
    expect(t.tables.run[0]).toMatchObject({ status: "merged", mergedSha: "m1" });
    expect(t.tables.idea[0]).toMatchObject({ status: "done" });
    expect(t.tables.idea[0].closureNote).toMatch(/PR #7/);
  });

  it("marks an unmerged closed PR as closed and leaves the idea alone", async () => {
    await prOpenRun();
    await handleWebhook("pull_request", { action: "closed", number: 7, repository: { full_name: "acme/app" }, pull_request: { number: 7, merged: false } }, "d16", deps());
    expect(t.tables.run[0].status).toBe("closed");
    expect(t.tables.idea[0].status).toBe("building");
  });
});

describe("auto-merge (D9 guards)", () => {
  const suite = (id: string) => handleWebhook("check_suite", { action: "completed", repository: { full_name: "acme/app" }, check_suite: { pull_requests: [{ number: 7 }] } }, id, deps());

  it("is off by default: green checks do not merge", async () => {
    await prOpenRun();
    await suite("a1");
    expect(log.some((l) => l.startsWith("merge "))).toBe(false);
    expect(t.tables.run[0].status).toBe("pr_open");
  });

  it("merges when opted in, base is protected and checks are green, pinned to the head sha", async () => {
    t.tables.project[0].autoMerge = true;
    await prOpenRun();
    await suite("a2");
    expect(log).toContain("merge 7@head1");
    expect(t.tables.run[0].status).toBe("merged");
    expect(t.tables.idea[0].status).toBe("done");
  });

  it("refuses on an unprotected base branch", async () => {
    t.tables.project[0].autoMerge = true;
    gh.state.branches.main.protected = false;
    await prOpenRun();
    await suite("a3");
    expect(t.tables.run[0].status).toBe("pr_open");
  });

  it("refuses when checks are red or pending", async () => {
    t.tables.project[0].autoMerge = true;
    await prOpenRun();
    gh.state.checks = { state: "red", failing: ["tests"] };
    await suite("a4");
    gh.state.checks = { state: "pending", failing: [] };
    await suite("a5");
    expect(t.tables.run[0].status).toBe("pr_open");
  });
});

describe("mergeRun (manual)", () => {
  it("needs green checks and an open PR", async () => {
    await prOpenRun();
    gh.state.checks = { state: "pending", failing: [] };
    await expect(mergeRun("u1", "RUN1", {}, deps())).rejects.toThrow(/not all passed/);
    gh.state.checks = { state: "red", failing: ["tests"] };
    await expect(mergeRun("u1", "RUN1", {}, deps())).rejects.toThrow(/tests/);
    gh.state.checks = { state: "green", failing: [] };
    gh.state.pr = { ...gh.state.pr, state: "closed" };
    await expect(mergeRun("u1", "RUN1", {}, deps())).rejects.toThrow(/no longer open/);
  });

  it("merges when green and marks the idea done", async () => {
    await prOpenRun();
    expect(await mergeRun("u1", "RUN1", {}, deps())).toEqual({ merged: true, sha: "merge1" });
    expect(t.tables.run[0].status).toBe("merged");
  });

  it("is not available to another user", async () => {
    await prOpenRun();
    await expect(mergeRun("u2", "RUN1", {}, deps())).rejects.toMatchObject({ status: 404 });
  });
});

describe("reviseRun", () => {
  it("re-dispatches on the same branch and keeps the same PR", async () => {
    await prOpenRun();
    await reviseRun("u1", "RUN1", "Use a darker blue", deps());
    expect(t.tables.run[0].status).toBe("dispatched");
    expect(gh.state.lastInputs.prompt).toContain("REVISION");
    expect(gh.state.lastInputs.prompt).toContain("darker blue");
    log.length = 0;
    await handleWebhook("workflow_run", wfRun("completed", { conclusion: "success" }), "r1", deps());
    expect(t.tables.run[0]).toMatchObject({ status: "pr_open", prNumber: 7 });
    expect(log.some((l) => l.startsWith("openPr"))).toBe(false);
  });

  it("needs an instruction and an open PR", async () => {
    await prOpenRun();
    await expect(reviseRun("u1", "RUN1", "  ", deps())).rejects.toMatchObject({ status: 400 });
    await dispatchedRunReset();
  });
});

async function dispatchedRunReset() {
  t.tables.run[0].status = "merged";
  await expect(reviseRun("u1", "RUN1", "x", deps())).rejects.toMatchObject({ status: 409 });
}

describe("revertRun", () => {
  it("only reverts merged runs, once", async () => {
    await prOpenRun();
    await expect(revertRun("u1", "RUN1", deps())).rejects.toMatchObject({ status: 409 });
    await mergeRun("u1", "RUN1", {}, deps());
    const rev = await revertRun("u1", "RUN1", deps());
    expect(rev.status).toBe("pr_open");
    expect(t.tables.run.find((r) => r.id === rev.id)).toMatchObject({ kind: "revert", prNumber: 9, parentRunId: "RUN1" });
    await expect(revertRun("u1", "RUN1", deps())).rejects.toThrow(/already exists/);
  });
});

describe("cancelRun", () => {
  it("cancels a waiting run and closes the PR of an open one", async () => {
    await startedRun();
    await cancelRun("u1", "RUN1", deps());
    expect(t.tables.run[0].status).toBe("cancelled");
  });

  it("closes an open PR", async () => {
    await prOpenRun();
    await cancelRun("u1", "RUN1", deps());
    expect(log).toContain("closePr 7");
    expect(t.tables.run[0].status).toBe("closed");
  });

  it("refuses a finished run", async () => {
    await prOpenRun();
    await mergeRun("u1", "RUN1", {}, deps());
    await expect(cancelRun("u1", "RUN1", deps())).rejects.toBeInstanceOf(RunError);
  });
});

describe("reconcileRun", () => {
  const later = (ms: number) => ({ gh, now: () => new Date(Date.now() + ms) });

  it("fails a run that has been silent past the timeout", async () => {
    await dispatchedRun();
    await reconcileRun("RUN1", later(STUCK_AFTER_MS + 60_000));
    expect(t.tables.run[0].status).toBe("failed");
  });

  it("leaves a fresh run alone (cooldown)", async () => {
    await dispatchedRun();
    await reconcileRun("RUN1", later(1000));
    expect(t.tables.run[0].status).toBe("dispatched");
  });

  it("repairs a missed merge webhook", async () => {
    await prOpenRun();
    gh.state.pr = { ...gh.state.pr, merged: true, state: "closed", mergeCommitSha: "mm" };
    await reconcileRun("RUN1", later(60_000));
    expect(t.tables.run[0]).toMatchObject({ status: "merged", mergedSha: "mm" });
    expect(t.tables.idea[0].status).toBe("done");
  });

  it("repairs a missed close", async () => {
    await prOpenRun();
    gh.state.pr = { ...gh.state.pr, state: "closed" };
    await reconcileRun("RUN1", later(60_000));
    expect(t.tables.run[0].status).toBe("closed");
  });
});

describe("openSetupPr", () => {
  it("creates a branch, adds the workflow and opens a PR", async () => {
    t.tables.project[0].workflowInstalled = false;
    gh.state.workflow = false;
    const pr = await openSetupPr("u1", "p1", "idea-hq-app", deps());
    expect(pr.number).toBe(7);
    expect(log.some((l) => l.startsWith("putFile .github/workflows/idea-hq.yml"))).toBe(true);
    expect(t.tables.project[0].setupPrNumber).toBe(7);
  });

  it("reuses the open setup PR instead of opening a second one", async () => {
    t.tables.project[0].workflowInstalled = false;
    t.tables.project[0].setupPrNumber = 2;
    gh.state.workflow = false;
    gh.state.pr = { ...gh.state.pr, number: 2, state: "open" };
    const pr = await openSetupPr("u1", "p1", "idea-hq-app", deps());
    expect(pr.number).toBe(2);
    expect(log.some((l) => l.startsWith("openPr") || l.startsWith("createBranch"))).toBe(false);
  });

  it("does nothing if the workflow is already there", async () => {
    gh.state.workflow = true;
    await expect(openSetupPr("u1", "p1", "idea-hq-app", deps())).rejects.toThrow(/already installed/);
    expect(t.tables.project[0].workflowInstalled).toBe(true);
  });

  it("is not available to another user's project", async () => {
    await expect(openSetupPr("u2", "p1", "app", deps())).rejects.toMatchObject({ status: 404 });
  });
});
