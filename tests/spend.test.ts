import { describe, it, expect, vi, beforeEach } from "vitest";

// Spend per project and month, and the project routes that show it and set the cap.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { spendByProject, capState, cleanCap, monthStart, capMessage } from "@/lib/spend";
import { GET as listProjects } from "@/app/api/projects/route";
import { PATCH as patchProject } from "@/app/api/projects/[id]/route";

const NOW = new Date("2026-10-20T12:00:00Z");
const run = (data: Record<string, unknown>) => db.run.create({ data: { userId: "u1", projectId: "p1", ...data } as never });

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "boss@x.se";
  sess.user = { id: "u1", email: "u1@x.se" };
  await db.user.create({ data: { id: "u1", email: "u1@x.se", approved: true } });
  await db.user.create({ data: { id: "u2", email: "u2@x.se", approved: true } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
  await db.project.create({ data: { id: "p2", userId: "u1", name: "Blog", slug: "blog", context: "" } });
  await db.project.create({ data: { id: "p3", userId: "u2", name: "Theirs", slug: "theirs", context: "" } });
});

describe("spendByProject", () => {
  it("adds up this month's implement and learn runs per project and counts runs that never reported a cost", async () => {
    await run({ kind: "implement", status: "merged", costUsd: 1.234, createdAt: NOW });
    await run({ kind: "learn", status: "merged", costUsd: 0.5, createdAt: NOW });
    await run({ kind: "implement", status: "pr_open", costUsd: null, createdAt: NOW, provider: "openai" });
    await run({ kind: "implement", status: "awaiting_approval", costUsd: null, createdAt: NOW });
    await run({ kind: "revert", status: "merged", costUsd: 9, createdAt: NOW });
    await run({ kind: "implement", status: "merged", costUsd: 7, createdAt: new Date("2026-09-30T23:59:00Z") });
    await run({ projectId: "p2", kind: "implement", status: "merged", costUsd: 2, createdAt: NOW });
    const m = await spendByProject("u1", NOW);
    expect(m.get("p1")).toEqual({ monthUsd: 1.73, runs: 4, unpriced: 1 });
    expect(m.get("p2")).toEqual({ monthUsd: 2, runs: 1, unpriced: 0 });
    expect(m.has("p3")).toBe(false);
  });
  it("starts a new month on the 1st, UTC", () => {
    expect(monthStart(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(monthStart(new Date("2027-01-01T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("capState and cleanCap", () => {
  it("is never reached without a cap, reached exactly at the cap", async () => {
    await run({ kind: "implement", status: "merged", costUsd: 4, createdAt: NOW });
    expect(await capState("p1", NOW)).toEqual({ capUsd: null, monthUsd: 0, reached: false });
    await db.project.update({ where: { id: "p1" }, data: { monthlyCapUsd: 4.01 } });
    expect((await capState("p1", NOW)).reached).toBe(false);
    await db.project.update({ where: { id: "p1" }, data: { monthlyCapUsd: 4 } });
    const s = await capState("p1", NOW);
    expect(s).toEqual({ capUsd: 4, monthUsd: 4, reached: true });
    expect(capMessage("Shop", s)).toMatch(/Shop is reached: \$4\.00 of \$4\.00/);
  });
  it("accepts a sensible amount or empty, rejects the rest", () => {
    expect(cleanCap(10)).toEqual({ ok: true, value: 10 });
    expect(cleanCap(2.345)).toEqual({ ok: true, value: 2.35 });
    expect(cleanCap(null)).toEqual({ ok: true, value: null });
    for (const bad of [0, -5, 0.1, 100001, NaN, "10", {}, true]) expect(cleanCap(bad), String(bad)).toMatchObject({ ok: false });
  });
});

describe("project routes", () => {
  const patch = (id: string, body: unknown) => patchProject(new Request("https://x/api/projects/" + id, { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });
  it("the list carries each project's spend, and only the signed-in person's projects", async () => {
    await run({ kind: "implement", status: "merged", costUsd: 3, createdAt: new Date() });
    const rows = await (await listProjects()).json();
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(["p1", "p2"]);
    expect(rows.find((r: { id: string }) => r.id === "p1").spend).toMatchObject({ monthUsd: 3, runs: 1 });
    expect(rows.find((r: { id: string }) => r.id === "p2").spend).toEqual({ monthUsd: 0, runs: 0, unpriced: 0 });
  });
  it("sets, changes and clears the cap, and rejects a bad one with a plain message", async () => {
    expect((await patch("p1", { monthlyCapUsd: 25 })).status).toBe(200);
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.monthlyCapUsd).toBe(25);
    const bad = await patch("p1", { monthlyCapUsd: -1 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/between \$0\.5 and \$100000/);
    expect((await patch("p1", { monthlyCapUsd: null })).status).toBe(200);
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.monthlyCapUsd).toBeNull();
  });
  it("cannot set a cap on someone else's project", async () => {
    expect((await patch("p3", { monthlyCapUsd: 5 })).status).toBe(404);
    expect((await db.project.findUnique({ where: { id: "p3" } }))?.monthlyCapUsd).toBeNull();
  });
});
