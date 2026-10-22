import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));

import { db, resetDb } from "./pg";
import { summarizeHistory, historyLine, MIN_RUNS, type HistoryRun } from "@/lib/runs/history";
import { loadHistory, stageDurations } from "@/lib/runs/history-store";

const run = (size: string | null, turns: number | null, costUsd: number | null = 0.02, total: number | null = 300000, ai: number | null = 120000): HistoryRun => ({
  size, turns, costUsd, stageMs: total == null ? null : { total, ai },
});

describe("what a person's own runs show", () => {
  it("shows nothing for a size until there are enough runs to call it a range", () => {
    expect(summarizeHistory([])).toEqual({});
    expect(summarizeHistory([run("S", 8), run("S", 9)])).toEqual({});
    expect(MIN_RUNS).toBe(3);
    expect(summarizeHistory([run("S", 8), run("S", 9), run("S", 12)]).S?.turns).toEqual([8, 12]);
  });

  it("keeps sizes apart and never summarises an Epic or an unsized run", () => {
    const h = summarizeHistory([run("S", 5), run("S", 6), run("S", 7), run("M", 20), run("M", 22), run("M", 30), run("XL", 90), run("XL", 91), run("XL", 92), run(null, 4), run(null, 4), run(null, 4)]);
    expect(Object.keys(h).sort()).toEqual(["M", "S"]);
    expect(h.M?.turns).toEqual([20, 30]);
  });

  it("reads minutes and the AI's share from the stage times, rounded outwards to whole minutes", () => {
    const h = summarizeHistory([run("S", 8, 0.01, 250000, 110000), run("S", 9, 0.02, 300000, 120000), run("S", 10, 0.03, 410000, 150000)]).S!;
    expect(h.minutes).toEqual([4, 7]);
    expect(h.aiMinutes).toBe(2);
    expect(h.usd).toEqual([0.01, 0.03]);
  });

  it("leaves minutes out when most runs predate stage times, and cost out when it was not reported", () => {
    const h = summarizeHistory([run("S", 8, null, null), run("S", 9, null, null), run("S", 10, null, 300000)]).S!;
    expect(h.minutes).toBeNull();
    expect(h.aiMinutes).toBeNull();
    expect(h.usd).toBeNull();
  });

  it("uses only the 20 most recent runs of a size, and drops the odd outlier from ten runs on", () => {
    const old = Array.from({ length: 5 }, () => run("S", 99));
    const recent = Array.from({ length: 20 }, (_, i) => run("S", 10 + (i % 5)));
    expect(summarizeHistory([...recent, ...old]).S?.turns).toEqual([10, 14]);
    const spiky = [1, 8, 8, 9, 9, 10, 10, 11, 11, 80].map((n) => run("M", n));
    expect(summarizeHistory(spiky).M?.turns).toEqual([8, 11]);
  });

  it("says it in one plain sentence", () => {
    const h = summarizeHistory([run("S", 8, 0.01, 250000, 110000), run("S", 9, 0.02, 300000, 120000), run("S", 10, 0.03, 410000, 150000)]).S;
    expect(historyLine("S", h)).toBe("Your last 3 Quick changes took 8 to 10 turns, 4 to 7 minutes (about 2 of them the AI), $0.01 to $0.03.");
    expect(historyLine("S", h, { withCost: false })).not.toContain("$");
    expect(historyLine("M", undefined)).toBe("");
  });
});

describe("stage times from the workflow", () => {
  const s = (name: string, a: number, b: number) => ({ name, status: "completed", conclusion: "success", startedAt: new Date(a * 1000).toISOString(), completedAt: new Date(b * 1000).toISOString() });
  it("adds up the steps of each stage and the span of the whole run", () => {
    const m = stageDurations([{ name: "implement", status: "completed", conclusion: "success", startedAt: null, completedAt: null, steps: [s("Install", 0, 60), s("Run Claude Code", 60, 180), s("Post Install", 180, 182)] }]);
    expect(m).toEqual({ prepare: 60000, ai: 120000, total: 182000 });
  });
  it("gives nothing for no jobs or steps without times", () => {
    expect(stageDurations(null)).toBeNull();
    expect(stageDurations([])).toBeNull();
    expect(stageDurations([{ name: "x", status: "queued", conclusion: null, startedAt: null, completedAt: null, steps: [{ name: "Install", status: "queued", conclusion: null, startedAt: null, completedAt: null }] }])).toBeNull();
  });
});

describe("loading the history", () => {
  beforeEach(async () => {
    await resetDb();
    await db.user.createMany({ data: [{ id: "ann", email: "a@x.se", approved: true }, { id: "bob", email: "b@x.se", approved: true }] });
    await db.project.create({ data: { id: "p1", userId: "ann", name: "P", slug: "p", context: "c" } });
    await db.project.create({ data: { id: "p2", userId: "bob", name: "Q", slug: "q", context: "c" } });
    await db.idea.create({ data: { id: "i1", userId: "ann", projectId: "p1", title: "T", complexity: "M" } });
  });
  const add = (id: string, userId: string, over: Record<string, unknown>) =>
    db.run.create({ data: { id, userId, projectId: userId === "ann" ? "p1" : "p2", kind: "implement", status: "merged", turns: 7, costUsd: 0.02, ...over } });

  it("counts a person's own finished runs only, by the size they had when they started", async () => {
    for (const n of [1, 2, 3]) await add(`a${n}`, "ann", { sizeAtRun: "S", turns: 5 + n });
    await add("failed", "ann", { sizeAtRun: "S", status: "failed", turns: 40 });
    await add("rev", "ann", { sizeAtRun: "S", kind: "revise", turns: 41 });
    await add("noturns", "ann", { sizeAtRun: "S", turns: null });
    await add("bobs", "bob", { sizeAtRun: "S", turns: 50 });
    const h = await loadHistory("ann");
    expect(h.S?.count).toBe(3);
    expect(h.S?.turns).toEqual([6, 8]);
    expect((await loadHistory("bob")).S).toBeUndefined();
  });

  it("falls back to the idea's size for runs from before the size was recorded", async () => {
    for (const n of [1, 2, 3]) await add(`o${n}`, "ann", { ideaId: "i1", turns: 20 + n });
    expect((await loadHistory("ann")).M?.count).toBe(3);
  });
});

describe("the Guide says so", () => {
  it("explains that after a few runs the idea page shows the person's own numbers", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    vi.doMock("next-auth", () => ({ getServerSession: async () => null }));
    vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
    const html = renderToStaticMarkup(await (await import("@/app/guide/page")).default());
    expect(html).toMatch(/at least three changes of a size/);
    expect(html).toMatch(/what your own runs of that size cost/);
  });
});

describe("shown to the person", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("the runs route sends the history and the card prints it under the default range", () => {
    expect(read("src/app/api/ideas/[id]/runs/route.ts")).toMatch(/loadHistory\(auth\.userId\)/);
    const card = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(card).toMatch(/historyLine\(size, data\.history\[size\]/);
    expect(card.indexOf("sizeExpectation(size")).toBeLessThan(card.indexOf("historyLine(size"));
  });
  it("the card does not pull the database into the browser bundle", () => {
    expect(read("src/lib/runs/history.ts")).not.toMatch(/from "@\/lib\/db"|from "\.\/progress"/);
    expect(read("src/app/(app)/ideas/idea-journey.tsx")).not.toMatch(/history-store/);
  });
});
