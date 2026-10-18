import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const st = vi.hoisted(() => ({
  project: null as Record<string, unknown> | null,
  ideas: [] as Record<string, unknown>[],
  runs: [] as Record<string, unknown>[],
  started: [] as string[],
  approved: [] as string[],
  startStatus: "awaiting_approval",
  approveError: null as Error | null,
  space: { publicKey: "ihq_zVRhxITZAc8lM9uq" } as Record<string, unknown> | null,
  ownerOk: true,
  aiBuild: true,
}));

vi.mock("@/lib/db", () => ({
  db: {
    project: { findFirst: async (a: Row) => (st.project && a.where.id === st.project.id && a.where.userId === st.project.userId ? { ...st.project, ...(a.select ? {} : {}) } : null) },
    idea: {
      findFirst: async (a: Row) => st.ideas.filter((i) => i.projectId === a.where.projectId && i.userId === a.where.userId && i.title === a.where.title && (!a.where.status || i.status !== a.where.status.not))[0] ?? null,
      create: async (a: Row) => { const row = { id: "idea" + (st.ideas.length + 1), createdAt: new Date(), ...a.data }; st.ideas.push(row); return row; },
      update: async (a: Row) => { const r = st.ideas.find((i) => i.id === a.where.id)!; Object.assign(r, a.data); return r; },
    },
    run: { findFirst: async (a: Row) => st.runs.filter((r) => r.ideaId === a.where.ideaId).slice(-1)[0] ?? null },
    supportSpace: { findUnique: async () => st.space },
  },
}));

vi.mock("@/lib/runs/engine", async () => {
  const real = await vi.importActual<typeof import("@/lib/runs/engine")>("@/lib/runs/engine");
  return {
    ...real,
    assertAiBuild: async () => { if (!st.aiBuild) throw new real.RunError(403, "AI build is switched off for your account. Ask the owner."); },
    startRun: async (_u: string, ideaId: string) => { st.started.push(ideaId); const r = { id: "run1", ideaId, status: st.startStatus }; st.runs.push(r); return r; },
    approveRun: async (_u: string, runId: string) => { if (st.approveError) throw st.approveError; st.approved.push(runId); },
  };
});
vi.mock("@/lib/support/owner", () => ({
  requireTickets: async () => (st.ownerOk ? { userId: "u1", email: "o@x.se" } : { res: new Response(JSON.stringify({ error: "no" }), { status: 403 }) }),
}));

import { installSupport, installPlan, installStatus, INSTALL_IDEA_TITLE } from "@/lib/support/install";
import { RunError } from "@/lib/runs/engine";
import { POST } from "@/app/api/projects/[id]/support/install/route";

const SNIPPET = '<script src="https://ideahq.cloud/embed/ihq_zVRhxITZAc8lM9uq.js" defer></script>';
const ready = { id: "p1", userId: "u1", repoOwner: "me", repoName: "site", workflowInstalled: true, secretConfirmed: true };

beforeEach(() => {
  st.project = { ...ready };
  st.ideas = [];
  st.runs = [];
  st.started = [];
  st.approved = [];
  st.startStatus = "awaiting_approval";
  st.approveError = null;
  st.space = { publicKey: "ihq_zVRhxITZAc8lM9uq" };
  st.ownerOk = true;
  st.aiBuild = true;
});

describe("Add it for me", () => {
  it("the plan holds the exact script, the key and the guard rails", () => {
    const plan = installPlan({ snippet: SNIPPET, key: "ihq_zVRhxITZAc8lM9uq", origin: "https://ideahq.cloud" });
    expect(plan).toContain(SNIPPET);
    expect(plan).toContain("ihq_zVRhxITZAc8lM9uq");
    expect(plan).toMatch(/lazyOnload/);
    expect(plan).toMatch(/Do not change anything else/);
  });
  it("creates an idea with the plan, starts a run and approves it", async () => {
    const r = await installSupport("u1", "p1", SNIPPET, "ihq_zVRhxITZAc8lM9uq", "https://ideahq.cloud");
    expect(r).toEqual({ ideaId: "idea1", runId: "run1" });
    expect(st.ideas[0]).toMatchObject({ title: INSTALL_IDEA_TITLE, complexity: "S", userId: "u1", projectId: "p1" });
    expect(String(st.ideas[0].plan)).toContain(SNIPPET);
    expect(st.started).toEqual(["idea1"]);
    expect(st.approved).toEqual(["run1"]);
  });
  it("reuses the same idea on a second click instead of creating duplicates", async () => {
    await installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud");
    await installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud");
    expect(st.ideas).toHaveLength(1);
  });
  it("does not approve a run that is already moving", async () => {
    st.startStatus = "running";
    await installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud");
    expect(st.approved).toEqual([]);
  });
  it("refuses projects that are not AI ready, and starts nothing", async () => {
    for (const patch of [{ workflowInstalled: false }, { secretConfirmed: false }, { repoOwner: null }]) {
      st.project = { ...ready, ...patch };
      await expect(installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud")).rejects.toMatchObject({ status: 409 });
    }
    expect(st.ideas).toHaveLength(0);
    expect(st.started).toHaveLength(0);
  });
  it("a switched-off account is refused before any idea is created (no stray idea)", async () => {
    st.aiBuild = false;
    await expect(installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud")).rejects.toMatchObject({ status: 403 });
    expect(st.ideas).toHaveLength(0);
    expect(st.started).toHaveLength(0);
  });
  it("never touches another user's project", async () => {
    await expect(installSupport("someone-else", "p1", SNIPPET, "k", "https://ideahq.cloud")).rejects.toMatchObject({ status: 404 });
    expect(st.ideas).toHaveLength(0);
  });
  it("reports where the last attempt stands", async () => {
    expect(await installStatus("u1", "p1")).toBeNull();
    await installSupport("u1", "p1", SNIPPET, "k", "https://ideahq.cloud");
    st.runs[0].status = "pr_open";
    st.runs[0].prNumber = 7;
    expect(await installStatus("u1", "p1")).toEqual({ ideaId: "idea1", runStatus: "pr_open", prNumber: 7 });
  });
});

describe("POST /api/projects/[id]/support/install", () => {
  const call = () => POST(new Request("https://ideahq.cloud/x", { method: "POST" }), { params: { id: "p1" } });
  it("starts the run and returns the idea to follow", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ideaId: "idea1", runId: "run1" });
    expect(String(st.ideas[0].plan)).toContain("https://ideahq.cloud/embed/ihq_zVRhxITZAc8lM9uq.js");
  });
  it("needs the tickets feature", async () => {
    st.ownerOk = false;
    expect((await call()).status).toBe(403);
    expect(st.started).toHaveLength(0);
  });
  it("needs support turned on first", async () => {
    st.space = null;
    expect((await call()).status).toBe(400);
  });
  it("404s for a project that is not yours", async () => {
    st.project = { ...ready, userId: "u2" };
    expect((await call()).status).toBe(404);
  });
  it("returns the plain 403 message for a switched-off account", async () => {
    st.aiBuild = false;
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/switched off/);
    expect(st.ideas).toHaveLength(0);
  });
  it("passes on plain-language problems from the run engine", async () => {
    st.approveError = new RunError(409, "Another run is already executing on this project. Wait for it to finish.");
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Another run/);
  });
});
