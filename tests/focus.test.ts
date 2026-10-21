import { describe, it, expect } from "vitest";
import { makeFakeDb } from "./fakedb";
import { rankFocusIdeas, loadFocusIdeas } from "@/app/(app)/ideas/focus";
import type { Idea } from "@/app/(app)/ideas/ideas-shared";

let seq = 0;
function idea(over: Partial<Idea> = {}): Idea {
  seq++;
  return {
    id: `i${seq}`,
    projectId: "p1",
    parentId: null,
    title: `Idea ${seq}`,
    notes: null,
    status: "new",
    priority: "none",
    tags: [],
    blockedBy: [],
    complexity: "M",
    impact: "high",
    scope: null,
    aiEstimatedAt: "2026-01-01T00:00:00.000Z",
    plan: null,
    plannedAt: null,
    closureNote: null,
    closedAt: null,
    kind: "idea",
    severity: null,
    repro: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Idea;
}

describe("rankFocusIdeas", () => {
  it("ranks by value vs. effort across projects", () => {
    const a = idea({ id: "a", projectId: "p1", complexity: "L", impact: "high" }); // 3/3 = 1
    const b = idea({ id: "b", projectId: "p2", complexity: "S", impact: "medium" }); // 2/1 = 2
    const c = idea({ id: "c", projectId: "p3", complexity: "M", impact: "high" }); // 3/2 = 1.5
    const { top, blockedCount } = rankFocusIdeas([a, b, c]);
    expect(top.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(blockedCount).toBe(0);
  });

  it("excludes done and parked ideas", () => {
    const ideas = [idea({ id: "done", status: "done" }), idea({ id: "parked", status: "parked" }), idea({ id: "open" })];
    expect(rankFocusIdeas(ideas).top.map((i) => i.id)).toEqual(["open"]);
  });

  it("includes considering and building ideas", () => {
    const ideas = [idea({ id: "c", status: "considering" }), idea({ id: "b", status: "building" })];
    expect(rankFocusIdeas(ideas).top).toHaveLength(2);
  });

  it("excludes un-estimated ideas", () => {
    const ideas = [
      idea({ id: "noAi", aiEstimatedAt: null }),
      idea({ id: "noComplexity", complexity: null }),
      idea({ id: "noImpact", impact: null }),
      idea({ id: "ok" }),
    ];
    expect(rankFocusIdeas(ideas).top.map((i) => i.id)).toEqual(["ok"]);
  });

  it("excludes epics but keeps their stories", () => {
    const epic = idea({ id: "epic", _count: { children: 2 } });
    const story = idea({ id: "story", parentId: "epic" });
    expect(rankFocusIdeas([epic, story]).top.map((i) => i.id)).toEqual(["story"]);
  });

  it("hides ideas blocked by a non-done dependency and counts them", () => {
    const dep = idea({ id: "dep", status: "building", complexity: "XL", impact: "low" });
    const blocked = idea({ id: "blocked", blockedBy: ["dep"] });
    const { top, blockedCount } = rankFocusIdeas([dep, blocked]);
    expect(top.map((i) => i.id)).toEqual(["dep"]);
    expect(blockedCount).toBe(1);
  });

  it("includes an idea once its dependency is done", () => {
    const dep = idea({ id: "dep", status: "done" });
    const unblocked = idea({ id: "unblocked", blockedBy: ["dep"] });
    const { top, blockedCount } = rankFocusIdeas([dep, unblocked]);
    expect(top.map((i) => i.id)).toEqual(["unblocked"]);
    expect(blockedCount).toBe(0);
  });

  it("ignores dangling dependency ids", () => {
    const ideas = [idea({ id: "x", blockedBy: ["gone"] })];
    const { top, blockedCount } = rankFocusIdeas(ideas);
    expect(top.map((i) => i.id)).toEqual(["x"]);
    expect(blockedCount).toBe(0);
  });

  it("returns at most the limit", () => {
    const ideas = Array.from({ length: 8 }, (_, n) => idea({ id: `n${n}` }));
    expect(rankFocusIdeas(ideas).top).toHaveLength(5);
    expect(rankFocusIdeas(ideas, 3).top).toHaveLength(3);
  });

  it("breaks ties by priority, then older creation, then id", () => {
    const low = idea({ id: "low", priority: "low", createdAt: "2026-01-01T00:00:00.000Z" });
    const highNew = idea({ id: "highNew", priority: "high", createdAt: "2026-03-01T00:00:00.000Z" });
    const highOld = idea({ id: "highOld", priority: "high", createdAt: "2026-02-01T00:00:00.000Z" });
    expect(rankFocusIdeas([low, highNew, highOld]).top.map((i) => i.id)).toEqual(["highOld", "highNew", "low"]);

    const x = idea({ id: "b-tie", createdAt: "2026-01-01T00:00:00.000Z" });
    const y = idea({ id: "a-tie", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(rankFocusIdeas([x, y]).top.map((i) => i.id)).toEqual(["a-tie", "b-tie"]);
  });
});

describe("loadFocusIdeas", () => {
  it("loads only the signed-in user's ideas, with their project", async () => {
    const t = makeFakeDb();
    t.tables.project.push(
      { id: "p1", userId: "me", name: "Mine", slug: "mine", color: "#10b981" },
      { id: "p2", userId: "them", name: "Theirs", slug: "theirs", color: null }
    );
    t.tables.idea.push(
      { id: "mine", userId: "me", projectId: "p1", title: "Mine", status: "new", priority: "none", blockedBy: [], complexity: "S", impact: "high", aiEstimatedAt: new Date(), createdAt: new Date("2026-01-01") },
      { id: "theirs", userId: "them", projectId: "p2", title: "Theirs", status: "new", priority: "none", blockedBy: [], complexity: "S", impact: "high", aiEstimatedAt: new Date(), createdAt: new Date("2026-01-01") }
    );

    const ideas = await loadFocusIdeas(t.db as any, "me"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ideas.map((i) => i.id)).toEqual(["mine"]);
    expect(ideas[0].project?.name).toBe("Mine");
    expect(typeof ideas[0].createdAt).toBe("string");

    const { top } = rankFocusIdeas(ideas);
    expect(top.map((i) => i.id)).toEqual(["mine"]);
  });
});
