import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import { rankFocusIdeas } from "@/app/(app)/ideas/focus";
import { loadFocusIdeas } from "@/app/(app)/focus/load-focus";
import type { Idea } from "@/app/(app)/ideas/ideas-shared";

// The loader is tested against the in-memory fake database.
const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }),
}));

const T0 = "2026-01-01T00:00:00.000Z";

// A fully estimated, open idea in project p1 unless overridden.
function idea(id: string, o: Partial<Idea> = {}): Idea {
  return {
    id, projectId: "p1", parentId: null, project: null, title: `Idea ${id}`, notes: null,
    status: "new", priority: "none", tags: [], blockedBy: [], complexity: "M", impact: "high",
    scope: null, aiEstimatedAt: T0, plan: null, plannedAt: null, closureNote: null, closedAt: null,
    kind: "idea", severity: null, repro: null, createdAt: T0, ...o,
  };
}

const ids = (ideas: Idea[]) => ideas.map((i) => i.id);

describe("rankFocusIdeas", () => {
  it("ranks by value vs. effort across projects", () => {
    const { top, blockedCount } = rankFocusIdeas([
      idea("d", { projectId: "p1", complexity: "XL", impact: "low" }), // 0.25
      idea("b", { projectId: "p2", complexity: "M", impact: "high" }), // 1.5
      idea("a", { projectId: "p1", complexity: "S", impact: "high" }), // 3
      idea("e", { projectId: "p2", complexity: "L", impact: "medium" }), // ~0.67
      idea("c", { projectId: "p2", complexity: "S", impact: "medium" }), // 2
    ]);
    expect(ids(top)).toEqual(["a", "c", "b", "e", "d"]);
    expect(blockedCount).toBe(0);
  });

  it("excludes done and parked ideas", () => {
    const { top } = rankFocusIdeas([
      idea("done", { status: "done", complexity: "S" }),
      idea("parked", { status: "parked", complexity: "S" }),
      idea("open", { status: "considering" }),
      idea("building", { status: "building" }),
    ]);
    expect(ids(top).sort()).toEqual(["building", "open"]);
  });

  it("excludes un-estimated ideas", () => {
    const { top } = rankFocusIdeas([
      idea("noEstimate", { aiEstimatedAt: null }),
      idea("noEffort", { complexity: null }),
      idea("noImpact", { impact: null }),
      idea("ok"),
    ]);
    expect(ids(top)).toEqual(["ok"]);
  });

  it("hides ideas blocked by a non-done dependency, shows them once it is done, ignores dangling ids", () => {
    const blocked = [
      idea("j", { complexity: "S", blockedBy: ["k"] }), // blocked by k (new)
      idea("k", { complexity: "L", impact: "low" }),
      idea("m", { complexity: "S", blockedBy: ["j"] }), // blocked by j (new)
      idea("n", { blockedBy: ["gone"] }), // dangling id: ignored
    ];
    const first = rankFocusIdeas(blocked);
    expect(ids(first.top)).toEqual(["n", "k"]);
    expect(first.blockedCount).toBe(2);

    // k ships: j is free, m still waits on j.
    const shipped = rankFocusIdeas(blocked.map((i) => (i.id === "k" ? { ...i, status: "done" } : i)));
    expect(ids(shipped.top)).toEqual(["j", "n"]);
    expect(shipped.blockedCount).toBe(1);
  });

  it("returns at most `limit` ideas, five by default", () => {
    const many = Array.from({ length: 7 }, (_, i) => idea(`x${i}`, { complexity: "S", impact: i % 2 ? "high" : "medium" }));
    expect(rankFocusIdeas(many).top).toHaveLength(5);
    expect(rankFocusIdeas(many, 2).top).toHaveLength(2);
    expect(rankFocusIdeas([]).top).toEqual([]);
  });

  it("breaks score ties by priority, then older createdAt, then id", () => {
    const { top } = rankFocusIdeas([
      idea("older", { createdAt: "2026-01-01T00:00:00.000Z" }),
      idea("newer", { createdAt: "2026-03-01T00:00:00.000Z" }),
      idea("urgent", { priority: "high", createdAt: "2026-06-01T00:00:00.000Z" }),
      idea("b-same", { createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(ids(top)).toEqual(["urgent", "b-same", "older", "newer"]);
  });

  it("counts only otherwise-eligible ideas as blocked", () => {
    const { blockedCount } = rankFocusIdeas([
      idea("dep", { complexity: "XL" }),
      idea("blocked", { blockedBy: ["dep"] }),
      idea("parkedBlocked", { status: "parked", blockedBy: ["dep"] }),
      idea("unestimated", { aiEstimatedAt: null, blockedBy: ["dep"] }),
    ]);
    expect(blockedCount).toBe(1);
  });
});

describe("loadFocusIdeas", () => {
  let t: ReturnType<typeof makeFakeDb>;
  beforeEach(() => {
    t = makeFakeDb();
    holder.db = t.db;
    t.tables.project.push(
      { id: "p-a1", userId: "u-a", name: "Alpha", slug: "alpha", color: "#10b981" },
      { id: "p-a2", userId: "u-a", name: "Beta", slug: "beta", color: null },
      { id: "p-b1", userId: "u-b", name: "Other", slug: "other", color: "#f00" },
    );
    const row = (id: string, userId: string, projectId: string, o: Record<string, unknown> = {}) => ({
      id, userId, projectId, title: `Idea ${id}`, status: "new", priority: "none", blockedBy: [],
      complexity: "S", impact: "high", aiEstimatedAt: new Date(T0), createdAt: new Date(T0), ...o,
    });
    t.tables.idea.push(
      row("i-a1", "u-a", "p-a1"),
      row("i-a2", "u-a", "p-a2", { complexity: "L", impact: "medium", createdAt: new Date("2026-02-01T00:00:00.000Z") }),
      row("i-b1", "u-b", "p-b1", { complexity: "S", impact: "high" }), // another user's best idea
    );
  });

  it("loads only the signed-in user's ideas, across projects, with project info", async () => {
    const ideas = await loadFocusIdeas("u-a");
    expect(ids(ideas).sort()).toEqual(["i-a1", "i-a2"]);
    const first = ideas.find((i) => i.id === "i-a1");
    expect(first?.project).toEqual({ name: "Alpha", color: "#10b981" });
    expect(first?.createdAt).toBe(T0);
    expect(first?.aiEstimatedAt).toBe(T0);
  });

  it("never lets another user's ideas into the focus list", async () => {
    const { top } = rankFocusIdeas(await loadFocusIdeas("u-a"));
    expect(ids(top)).not.toContain("i-b1");
    expect(ids(top)).toEqual(["i-a1", "i-a2"]);
  });
});
