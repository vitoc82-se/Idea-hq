import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { GET as listIdeas } from "@/app/api/ideas/route";
import { boardNext, wantsPlan, type BoardInput } from "@/lib/runs/journey";
import { planBatch, MAX_PER_PRESS } from "@/app/(app)/ideas/plan-batch";
import type { Idea } from "@/app/(app)/ideas/ideas-shared";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const input = (over: Partial<BoardInput> = {}): BoardInput => ({ idea: { title: "Add a footer", complexity: "S", plan: "A brief", status: "new" }, run: null, epic: null, ...over });

describe("the stage and next step shown on each board row", () => {
  it("an idea with no plan is at Describe and next is Plan it; once planned it is at Plan and next is Build it", () => {
    expect(boardNext(input({ idea: { title: "x", complexity: null, plan: null, status: "new" } }))).toMatchObject({ stageLabel: "Describe", number: 1, next: "Plan it", action: "plan" });
    expect(boardNext(input())).toMatchObject({ stageLabel: "Plan", number: 2, next: "Build it", action: "build" });
  });
  it("follows the run: waiting for approval, the AI working, checks running, checks red or green, merged", () => {
    expect(boardNext(input({ run: { status: "awaiting_approval" } }))).toMatchObject({ stageLabel: "Plan", action: "approve" });
    expect(boardNext(input({ run: { status: "running" } }))).toMatchObject({ stageLabel: "Build", next: "The AI is working on it", action: null });
    expect(boardNext(input({ run: { status: "pr_open", checksState: "pending" } }))).toMatchObject({ stageLabel: "Review", next: "Your project's checks are running", action: null });
    expect(boardNext(input({ run: { status: "pr_open", checksState: "red" } }))).toMatchObject({ stageLabel: "Review", next: "Ask the AI to fix it", action: "fix" });
    expect(boardNext(input({ run: { status: "pr_open", checksState: "green" } }))).toMatchObject({ stageLabel: "Review", next: "Merge", action: "merge" });
    expect(boardNext(input({ run: { status: "merged" } }))).toMatchObject({ stageLabel: "Ship", number: 5, next: "Done: merged", action: null });
    expect(boardNext(input({ run: { status: "failed" } }))).toMatchObject({ stageLabel: "Build", next: "Try again", action: "retry" });
  });
  it("a finished idea is at Ship, a parked one is off the journey", () => {
    expect(boardNext(input({ idea: { title: "x", complexity: "S", plan: null, status: "done" } }))).toMatchObject({ stage: "ship", action: null });
    expect(boardNext(input({ idea: { title: "x", complexity: null, plan: null, status: "parked" } }))).toMatchObject({ stage: null, stageLabel: "Parked", number: 0 });
  });
  it("an Epic says split it; one already split points at the next step", () => {
    expect(boardNext(input({ idea: { title: "x", complexity: "XL", plan: null, status: "new" } }))).toMatchObject({ next: "Split it into steps", action: "split" });
    const epic = { children: [{ id: "a", status: "done" }, { id: "b", status: "new" }], nextId: "b" };
    expect(boardNext(input({ epic }))).toMatchObject({ next: "Open the next step", action: "nextStep" });
  });
  it("an idea waiting on another says which, and offers no build", () => {
    const b = boardNext(input({ blockedBy: ["Login"] }));
    expect(b.action).toBeNull();
    expect(b.next).toMatch(/Blocked by "Login"/);
  });
  it("only an unplanned, unparked idea that is not an Epic counts for Plan them all", () => {
    expect(wantsPlan(input({ idea: { title: "x", complexity: null, plan: null, status: "new" } }))).toBe(true);
    expect(wantsPlan(input({ idea: { title: "x", complexity: "M", plan: null, status: "considering" } }))).toBe(true);
    expect(wantsPlan(input())).toBe(false);
    expect(wantsPlan(input({ idea: { title: "x", complexity: "XL", plan: null, status: "new" } }))).toBe(false);
    expect(wantsPlan(input({ idea: { title: "x", complexity: null, plan: null, status: "parked" } }))).toBe(false);
    expect(wantsPlan(input({ idea: { title: "x", complexity: null, plan: null, status: "done" } }))).toBe(false);
    // waiting on another idea does not stop it being planned
    expect(wantsPlan(input({ idea: { title: "x", complexity: null, plan: null, status: "new" }, blockedBy: ["Login"] }))).toBe(true);
  });
});

describe("Plan them all", () => {
  const idea = (id: string, complexity: string | null = null): Idea => ({ id, title: id, complexity, plan: null, status: "new", tags: [], blockedBy: [] } as unknown as Idea);
  function fake(opts: { sizeOf?: Record<string, string>; fail?: Record<string, number | "throw">; delay?: boolean } = {}) {
    const calls: string[] = [];
    const changed: Idea[] = [];
    const settled: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      const [, , , id, kind] = url.split("/");
      const bad = opts.fail?.[`${id}/${kind}`];
      if (bad === "throw") throw new Error("offline");
      if (typeof bad === "number") return new Response(JSON.stringify({ error: `bad ${id}` }), { status: bad });
      const body = kind === "estimate" ? { id, complexity: opts.sizeOf?.[id] ?? "S", scope: "s" } : { id, plan: "P" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, changed, settled, deps: { fetch: f, onIdea: (i: Idea) => changed.push(i), onSettle: (id: string) => settled.push(id) } };
  }

  it("sizes an unsized idea and then plans it, and only plans one that is already sized", async () => {
    const t = fake();
    const r = await planBatch([idea("a"), idea("b", "M")], t.deps);
    expect(r.planned.sort()).toEqual(["a", "b"]);
    expect(t.calls.filter((c) => c.endsWith("/estimate"))).toEqual(["/api/ideas/a/estimate"]);
    expect(t.calls.filter((c) => c.endsWith("/plan")).sort()).toEqual(["/api/ideas/a/plan", "/api/ideas/b/plan"]);
    expect(t.settled.sort()).toEqual(["a", "b"]);
    expect(r).toMatchObject({ epics: [], stopped: null, left: 0 });
  });

  it("an Epic is sized but not planned, and is reported", async () => {
    const t = fake({ sizeOf: { big: "XL" } });
    const r = await planBatch([idea("big"), idea("small")], t.deps);
    expect(r.epics).toEqual(["big"]);
    expect(r.planned).toEqual(["small"]);
    expect(t.calls).not.toContain("/api/ideas/big/plan");
    expect(t.changed.find((i) => i.id === "big")?.complexity).toBe("XL");
  });

  it("does at most ten per press and says how many are left", async () => {
    const ideas = Array.from({ length: 13 }, (_, i) => idea(`i${i}`, "S"));
    const t = fake();
    const r = await planBatch(ideas, t.deps);
    expect(MAX_PER_PRESS).toBe(10);
    expect(r.planned).toHaveLength(10);
    expect(r.left).toBe(3);
    expect(t.calls.some((c) => c.includes("/i12/"))).toBe(false);
  });

  it("stops at the daily limit and leaves the rest to do, with every spinner cleared", async () => {
    const ideas = Array.from({ length: 6 }, (_, i) => idea(`i${i}`, "S"));
    const t = fake({ fail: { "i0/plan": 429, "i1/plan": 429 } });
    const r = await planBatch(ideas, t.deps);
    expect(r.stopped).toMatch(/Daily AI limit reached/);
    expect(r.planned.length + r.left + 2).toBe(6); // the two that hit the limit are not counted as left, the rest are
    expect(new Set(t.settled)).toEqual(new Set(ideas.map((i) => i.id)));
  });

  it("shows the server's message when a plan fails, and a plain one when the network is down", async () => {
    expect((await planBatch([idea("a", "S")], fake({ fail: { "a/plan": 400 } }).deps)).stopped).toBe("bad a");
    expect((await planBatch([idea("a", "S")], fake({ fail: { "a/plan": "throw" } }).deps)).stopped).toMatch(/Could not reach Idea HQ/);
  });
});

describe("the ideas list tells the board where each idea stands", () => {
  beforeEach(async () => {
    await resetDb();
    sess.user = { id: "u1", email: "ann@x.se" };
    await db.user.createMany({ data: [{ id: "u1", email: "ann@x.se", approved: true }, { id: "u2", email: "bob@x.se", approved: true }] });
    await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
    await db.project.create({ data: { id: "p2", userId: "u2", name: "Theirs", slug: "theirs", context: "" } });
  });
  const list = async () => (await (await listIdeas(new Request("https://x/api/ideas"))).json()) as { id: string; latestRun: { status: string; checksState: string | null } | null; epic: { children: { id: string; status: string }[]; nextId: string | null } | null }[];

  it("carries the latest build of each idea, and none for an idea with no build", async () => {
    await db.idea.createMany({ data: [{ id: "a", userId: "u1", projectId: "p1", title: "A" }, { id: "b", userId: "u1", projectId: "p1", title: "B" }] });
    const old = new Date(Date.now() - 86400000);
    await db.run.create({ data: { id: "r1", userId: "u1", projectId: "p1", ideaId: "a", kind: "implement", status: "failed", createdAt: old } });
    await db.run.create({ data: { id: "r2", userId: "u1", projectId: "p1", ideaId: "a", kind: "implement", status: "pr_open", checksState: "green" } });
    await db.run.create({ data: { id: "r3", userId: "u1", projectId: "p1", ideaId: "a", kind: "revert", status: "running" } });
    const rows = await list();
    expect(rows.find((r) => r.id === "a")?.latestRun).toMatchObject({ status: "pr_open", checksState: "green" });
    expect(rows.find((r) => r.id === "b")?.latestRun).toBeNull();
  });

  it("carries the steps of an idea split into steps, with the next one that can start", async () => {
    await db.idea.createMany({ data: [
      { id: "e", userId: "u1", projectId: "p1", title: "Epic" },
      { id: "s1", userId: "u1", projectId: "p1", title: "One", parentId: "e", status: "done" },
      { id: "s2", userId: "u1", projectId: "p1", title: "Two", parentId: "e", blockedBy: ["s1"] },
      { id: "s3", userId: "u1", projectId: "p1", title: "Three", parentId: "e", blockedBy: ["s2"] },
    ] });
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual(["e"]); // steps stay off the board
    expect(rows[0].epic).toEqual({ children: [{ id: "s1", status: "done" }, { id: "s2", status: "new" }, { id: "s3", status: "new" }], nextId: "s2" });
  });

  it("never shows another person's builds", async () => {
    await db.idea.create({ data: { id: "a", userId: "u1", projectId: "p1", title: "A" } });
    await db.run.create({ data: { id: "x", userId: "u2", projectId: "p2", ideaId: "a", kind: "implement", status: "merged" } });
    expect((await list())[0].latestRun).toBeNull();
  });

  it("an empty board still answers", async () => {
    expect(await list()).toEqual([]);
  });
});

describe("what the board shows", () => {
  const board = read("src/app/(app)/ideas/ideas-board.tsx");
  it("each row has the stage and the next step, and the old estimate-only prompts are gone", () => {
    expect(board).toMatch(/data-testid="idea-next"/);
    expect(board).toMatch(/boardNext\(\{ idea, run: idea\.latestRun/);
    expect(board).not.toMatch(/Estimate them all|not estimated, estimate now/);
  });
  it("Plan them all covers the ideas the filters show, and a press is capped", () => {
    expect(board).toMatch(/visible\.filter\(\(i\) => wantsPlan/);
    expect(board).toMatch(/Plan them all/);
    expect(board).toMatch(/MAX_PER_PRESS/);
  });
  it("building and merging stay on the idea page: the row only links there", () => {
    expect(board).not.toMatch(/\/api\/ideas\/[^"']*\/runs|startRun|approveRun/);
    expect(board).toMatch(/Next: \{step\.next\}/);
  });
  it("the import page points at the new button", () => {
    expect(read("src/components/backlog-import.tsx")).toMatch(/Plan them all/);
  });
});

describe("the polls and the list are cheap", () => {
  it("the runs route skips the history on a poll, and sends it otherwise", () => {
    const route = read("src/app/api/ideas/[id]/runs/route.ts");
    expect(route).toMatch(/searchParams\.has\("poll"\) \? undefined : await loadHistory/);
  });
  it("the ideas list takes each idea's latest build in the database, one row per idea", () => {
    const route = read("src/app/api/ideas/route.ts");
    expect(route).toMatch(/take: 1/);
    expect(route).not.toMatch(/distinct:/);
    expect(route).not.toMatch(/ideaId: \{ in: ids \}/);
  });
});
