import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }));
const engine = vi.hoisted(() => ({ reconciled: [] as string[], fail: new Set<string>() }));
vi.mock("@/lib/runs/engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/runs/engine")>()),
  reconcileRun: async (id: string) => { engine.reconciled.push(id); if (engine.fail.has(id)) throw new Error("GitHub down"); },
}));

import { db, resetDb } from "./pg";
import { findStuckRuns, checkStuckRuns } from "@/lib/runs/stuck";
import { STUCK_AFTER_MS } from "@/lib/runs/engine";
import { GET as stuckCron } from "@/app/api/cron/stuck-runs/route";
import { KanbanBoard } from "@/app/(app)/ideas/ideas-kanban";
import { boardNext } from "@/lib/runs/journey";
import type { Idea } from "@/app/(app)/ideas/ideas-shared";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const NOW = new Date("2026-10-22T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe("the daily check for runs nobody is watching", () => {
  beforeEach(async () => {
    await resetDb();
    engine.reconciled = []; engine.fail = new Set();
    await db.user.create({ data: { id: "u1", email: "a@x.se", approved: true } });
    await db.project.create({ data: { id: "p1", userId: "u1", name: "P", slug: "p", context: "" } });
  });
  const run = (id: string, status: string, over: Record<string, unknown> = {}) => db.run.create({ data: { id, userId: "u1", projectId: "p1", kind: "implement", status, createdAt: ago(300), ...over } });

  it("picks the dispatched and running runs older than the stuck limit, and nothing else", async () => {
    expect(STUCK_AFTER_MS).toBe(45 * 60_000);
    await run("old-dispatched", "dispatched", { startedAt: ago(50) });
    await run("old-running", "running", { startedAt: ago(120) });
    await run("never-started", "dispatched", { startedAt: null, createdAt: ago(60) });
    await run("fresh", "running", { startedAt: ago(10) });
    await run("fresh-no-start", "dispatched", { startedAt: null, createdAt: ago(5) });
    await run("waiting", "awaiting_approval", { startedAt: ago(500) });
    await run("pr", "pr_open", { startedAt: ago(500) });
    await run("done", "merged", { startedAt: ago(500) });
    await run("failed", "failed", { startedAt: ago(500) });
    const ids = (await findStuckRuns(NOW)).map((r) => r.id).sort();
    expect(ids).toEqual(["never-started", "old-dispatched", "old-running"]);
  });

  it("reconciles each, counts what came of it, and one that cannot be reached does not stop the rest", async () => {
    for (const id of ["recover", "fail", "same", "boom"]) await run(id, "running", { startedAt: ago(90) });
    engine.fail.add("boom");
    const outcome: Record<string, string> = { recover: "pr_open", fail: "failed" };
    const report = await checkStuckRuns(NOW, async (id) => {
      engine.reconciled.push(id);
      if (engine.fail.has(id)) throw new Error("GitHub down");
      if (outcome[id]) await db.run.update({ where: { id }, data: { status: outcome[id] } });
    });
    expect(report).toEqual({ checked: 4, recovered: 1, failed: 1, unchanged: 1, errors: 1 });
    expect(engine.reconciled.sort()).toEqual(["boom", "fail", "recover", "same"]);
  });

  it("is a bearer-protected route, like the other cron", async () => {
    process.env.CRON_SECRET = "c".repeat(32);
    for (const h of [undefined, "Bearer nope", "Bearer undefined", "c".repeat(32)]) {
      const r = await stuckCron(new Request("https://ideahq.cloud/api/cron/stuck-runs", { headers: h ? { authorization: h } : {} }));
      expect(r.status, String(h)).toBe(401);
    }
    await run("stuck", "running", { startedAt: new Date(Date.now() - 2 * 60 * 60_000) });
    const ok = await stuckCron(new Request("https://ideahq.cloud/x", { headers: { authorization: "Bearer " + "c".repeat(32) } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, checked: 1, unchanged: 1 });
    delete process.env.CRON_SECRET;
  });

  it("is scheduled every day, after the retention job", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    expect(crons).toContainEqual({ path: "/api/cron/stuck-runs", schedule: "30 3 * * *" });
    expect(crons.map((c) => c.path)).toContain("/api/cron/support-retention");
  });
});

describe("Node is pinned the same for development and CI", () => {
  it("one file says 20, and CI reads it instead of repeating it", () => {
    expect(read(".nvmrc").trim()).toBe("20");
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/node-version:\s*\d/);
    expect(ci.match(/node-version-file: \.nvmrc/g)).toHaveLength(2); // the verify job and the smoke job
    expect(read("README.md")).toMatch(/Use Node 20 \(`\.nvmrc`/);
  });
  it("engines is left out on purpose: Vercel takes its runtime from it, so adding it would change production's Node", () => {
    expect(JSON.parse(read("package.json")).engines).toBeUndefined();
  });
});

describe("the accent contrast: filled buttons with white text use the darker emerald", () => {
  it("no class string pairs bg-emerald-600 with white text, and the default button is emerald-700", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "generated") walk(full); continue; }
        if (!/\.(tsx|ts)$/.test(e.name)) continue;
        fs.readFileSync(full, "utf8").split("\n").forEach((l, i) => { if (/bg-emerald-600/.test(l) && /text-white/.test(l)) offenders.push(`${full}:${i + 1}`); });
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
    expect(read("src/components/ui/button.tsx")).toContain('default: "bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm"');
  });
  it("DESIGN.md says so and describes the journey card and its chips", () => {
    const design = read("DESIGN.md");
    expect(design).toMatch(/emerald-700 \(`#047857`, 5\.48:1\)/);
    for (const needle of ["## The idea journey (owner screens)", "One primary button", "Stage chip", "Needs you", "Status and stage", "minutes and cost", "Loading and failing are designed too"]) expect(design, needle).toContain(needle);
  });
  it("the old to-do is gone", () => {
    expect(read("TODOS.md")).not.toContain("Bring the app's accent to the 4.5:1");
  });
});

describe("the board's last loose ends", () => {
  const idea = (id: string, title: string, over: Partial<Idea> = {}) => ({ id, title, status: "new", priority: "none", tags: [], blockedBy: [], complexity: "S", plan: "P", scope: "x", kind: "idea", notes: null, projectId: "p", parentId: null, ...over }) as unknown as Idea;

  it("each card on the kanban board says its stage and what comes next", () => {
    const ideas = [
      idea("a", "Search box", { status: "building", latestRun: { id: "r", status: "pr_open", kind: "implement", checksState: "green" } }),
      idea("b", "Imported", { complexity: null, plan: null }),
      idea("c", "Maybe later", { status: "parked" }),
    ];
    const steps = new Map(ideas.map((i) => [i.id, boardNext({ idea: i, run: i.latestRun ?? null, epic: null })]));
    const html = renderToStaticMarkup(createElement(KanbanBoard, { ideas, blockedIds: new Set<string>(), steps, onStatus() {}, onClosure() {} }));
    expect(html).toMatch(/Stage: <\/span>Review · 4 of 5<\/span> · Merge/);
    expect(html).toMatch(/Describe · 1 of 5<\/span> · Plan it/);
    expect(html).toContain("Not planned for now"); // parked: no stage
    expect((html.match(/data-testid="kanban-next"/g) ?? []).length).toBe(3);
  });
  it("the board passes the steps to the kanban, and its hints are readable", () => {
    expect(read("src/app/(app)/ideas/ideas-board.tsx")).toMatch(/<KanbanBoard[\s\S]*?steps=\{nextById\}/);
    const kanban = read("src/app/(app)/ideas/ideas-kanban.tsx");
    expect(kanban).not.toMatch(/text-gray-300 dark:text-gray-600|text-xs text-gray-400/);
  });
  it("the subtitle talks about sizing and the steps, not 'estimate the build'", () => {
    const board = read("src/app/(app)/ideas/ideas-board.tsx");
    expect(board).not.toMatch(/estimate the build/);
    expect(board).toMatch(/Capture an idea and the AI sizes it; then plan it,\s+build it and merge it, one step at a time\./);
  });
});
