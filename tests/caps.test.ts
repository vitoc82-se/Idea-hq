import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// One account (or one buggy page) must not be able to fill the database or run up an AI bill with one request.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { CAPS, cleanHttpsUrl, cleanColor, tooLong } from "@/lib/caps";
import { middleware } from "@/middleware";
import { POST as createIdea } from "@/app/api/ideas/route";
import { PATCH as patchIdea } from "@/app/api/ideas/[id]/route";
import { POST as createProject } from "@/app/api/projects/route";
import { PATCH as patchProject } from "@/app/api/projects/[id]/route";
import { POST as breakdown } from "@/app/api/ideas/[id]/breakdown/route";
import { POST as addFact } from "@/app/api/projects/[id]/memory/route";
import { POST as runAction } from "@/app/api/runs/[id]/[action]/route";
import { addMemory } from "@/lib/knowledge-store";
import { createIssueFromTicket } from "@/lib/issues";

const ME = { id: "u1", email: "ann@x.se" };
const json = (body: unknown, method = "POST") => new Request("https://x/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ideas = async (n: number, projectId = "p1") => db.idea.createMany({ data: Array.from({ length: n }, (_, i) => ({ userId: "u1", projectId, title: `Idea ${i}` })) });

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = ME.email;
  sess.user = ME;
  await db.user.create({ data: { id: "u1", email: ME.email, approved: true } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
});

describe("request size (middleware)", () => {
  const req = (method: string, path: string, length?: number) => new NextRequest(`https://ideahq.cloud${path}`, { method, headers: length === undefined ? {} : { "content-length": String(length) } });
  it("refuses a body over 1 MB before any route reads it", () => {
    expect(middleware(req("POST", "/api/ideas", CAPS.bodyBytes + 1)).status).toBe(413);
    expect(middleware(req("PATCH", "/api/ideas/x", 5_000_000)).status).toBe(413);
    expect(middleware(req("POST", "/api/ideas", CAPS.bodyBytes)).status).toBe(200);
    expect(middleware(req("POST", "/api/ideas")).status).toBe(200);
  });
  it("lets a pasted backlog list be twice as big, but not more", () => {
    expect(middleware(req("POST", "/api/projects/p1/import/preview", 1_500_000)).status).toBe(200);
    expect(middleware(req("POST", "/api/projects/p1/import/preview", CAPS.bodyBytesLarge + 1)).status).toBe(413);
  });
  it("leaves reading alone and the signed webhooks alone", () => {
    expect(middleware(req("GET", "/api/ideas", 9_000_000)).status).toBe(200);
    expect(middleware(req("POST", "/api/github/webhook", 9_000_000)).status).toBe(200);
    expect(middleware(req("POST", "/api/billing/lemonsqueezy/webhook", 9_000_000)).status).toBe(200);
  });
  it("answers in plain words", async () => {
    const res = middleware(req("POST", "/api/ideas", 9_000_000));
    expect((await res.json()).error).toMatch(/too much/);
  });
});

describe("helpers", () => {
  it("tooLong names the field and the limit", () => {
    expect(tooLong("The title", "x".repeat(201), 200)).toBe("The title is too long (at most 200 characters).");
    expect(tooLong("The title", "x".repeat(200), 200)).toBeNull();
    expect(tooLong("The title", undefined, 200)).toBeNull();
    expect(tooLong("The title", 12345, 2)).toBeNull();
  });
  it("addresses must be short https links", () => {
    expect(cleanHttpsUrl("https://raw.githubusercontent.com/a/b/main/CONTEXT.md")).toEqual({ ok: true, value: "https://raw.githubusercontent.com/a/b/main/CONTEXT.md" });
    expect(cleanHttpsUrl("")).toEqual({ ok: true, value: null });
    expect(cleanHttpsUrl(null)).toEqual({ ok: true, value: null });
    for (const bad of ["http://x.se", "javascript:alert(1)", "file:///etc/passwd", "not a url", "https://x.se/" + "a".repeat(600), 42, {}]) expect(cleanHttpsUrl(bad).ok, String(bad)).toBe(false);
  });
  it("colours are short and plain", () => {
    expect(cleanColor("#10b981")).toBe("#10b981");
    expect(cleanColor("emerald")).toBe("emerald");
    for (const bad of ["", "<script>", "x".repeat(21), 5, null, "red; background:url(x)"]) expect(cleanColor(bad), String(bad)).toBeNull();
  });
});

describe("ideas", () => {
  it("title and notes have a limit when created, and exactly the limit is fine", async () => {
    expect((await createIdea(json({ projectId: "p1", title: "x".repeat(CAPS.title + 1) }))).status).toBe(400);
    expect((await createIdea(json({ projectId: "p1", title: "ok", notes: "x".repeat(CAPS.notes + 1) }))).status).toBe(400);
    expect((await createIdea(json({ projectId: "p1", title: "x".repeat(CAPS.title), notes: "x".repeat(CAPS.notes) }))).status).toBe(201);
    expect(await db.idea.count()).toBe(1);
  });
  it("and when edited", async () => {
    const i = await db.idea.create({ data: { userId: "u1", projectId: "p1", title: "A" } });
    for (const body of [{ title: "x".repeat(CAPS.title + 1) }, { notes: "x".repeat(CAPS.notes + 1) }, { closureNote: "x".repeat(CAPS.closureNote + 1) }]) {
      expect((await patchIdea(json(body, "PATCH"), ctx(i.id))).status, Object.keys(body)[0]).toBe(400);
    }
    expect((await patchIdea(json({ title: "B", notes: "n", closureNote: "c" }, "PATCH"), ctx(i.id))).status).toBe(200);
  });
  it("a project holds at most 2,000 ideas", async () => {
    await ideas(CAPS.ideasPerProject - 1);
    expect((await createIdea(json({ projectId: "p1", title: "the 2000th" }))).status).toBe(201);
    const res = await createIdea(json({ projectId: "p1", title: "one too many" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/limit/);
    // other projects are not affected
    await db.project.create({ data: { id: "p2", userId: "u1", name: "Other", slug: "other", context: "" } });
    expect((await createIdea(json({ projectId: "p2", title: "fine" }))).status).toBe(201);
  });
  it("blocked-by and tags are cut to a sensible number", async () => {
    await ideas(60);
    const all = (await db.idea.findMany({})).map((i: { id: string }) => i.id);
    const target = all[0];
    const res = await patchIdea(json({ blockedBy: all, tags: Array.from({ length: 200 }, (_, i) => `t${i}`) }, "PATCH"), ctx(target));
    expect(res.status).toBe(200);
    const row = (await db.idea.findUnique({ where: { id: target } }))!;
    expect(row.blockedBy.length).toBeLessThanOrEqual(CAPS.blockedBy);
    expect(row.tags.length).toBeLessThanOrEqual(CAPS.tagsPerIdea);
  });
  it("an epic is split into at most 40 stories, and stories respect the project limit", async () => {
    const epic = await db.idea.create({ data: { userId: "u1", projectId: "p1", title: "Epic" } });
    const story = (i: number) => ({ title: `Story ${i}`, notes: "n".repeat(CAPS.storyNotes + 500), scope: "s".repeat(CAPS.storyScope + 500) });
    expect((await breakdown(json({ commit: true, stories: Array.from({ length: CAPS.storiesPerBreakdown + 1 }, (_, i) => story(i)) }), ctx(epic.id))).status).toBe(400);
    expect((await breakdown(json({ commit: true, stories: [story(1)] }), ctx(epic.id))).status).toBe(201);
    const kid = (await db.idea.findFirst({ where: { parentId: epic.id } }))!;
    expect(kid.notes!.length).toBe(CAPS.storyNotes);
    expect(kid.scope!.length).toBe(CAPS.storyScope);
    await ideas(CAPS.ideasPerProject - 2); // the epic and its story are 2; now the project is exactly full
    const res = await breakdown(json({ commit: true, replace: true, stories: [story(2), story(3)] }), ctx(epic.id)); // replaces 1 with 2: one too many
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/limit/);
    expect((await breakdown(json({ commit: true, replace: true, stories: [story(4)] }), ctx(epic.id))).status).toBe(201); // replaces 1 with 1: fits
  });
  it("turning a ticket into a bug respects the project limit too", async () => {
    await db.ticket.create({ data: { id: "t1", projectId: "p1", number: 1, subject: "Broken", customerEmail: "c@x.se", tokenHash: "h", fields: [] } });
    await ideas(CAPS.ideasPerProject);
    await expect(createIssueFromTicket("u1", "t1", { kind: "bug", title: "Fix it" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("projects", () => {
  it("name, description, colour and source address are checked", async () => {
    const make = (b: Record<string, unknown>) => createProject(json({ name: "App", ...b }));
    expect((await make({ name: "x".repeat(CAPS.projectName + 1) })).status).toBe(400);
    expect((await make({ context: "x".repeat(CAPS.projectContext + 1) })).status).toBe(400);
    expect((await make({ contextSourceUrl: "http://insecure.example/x.md" })).status).toBe(400);
    expect((await make({ contextSourceUrl: "javascript:alert(1)" })).status).toBe(400);
    const ok = await make({ slug: "app", color: "<script>", contextSourceUrl: "https://raw.githubusercontent.com/a/b/main/C.md", context: "x".repeat(CAPS.projectContext) });
    expect(ok.status).toBe(201);
    const row = await ok.json();
    expect(row.color).toBeNull();
    expect(row.contextSourceUrl).toBe("https://raw.githubusercontent.com/a/b/main/C.md");
  });
  it("and when edited", async () => {
    for (const body of [{ name: "x".repeat(CAPS.projectName + 1) }, { context: "x".repeat(CAPS.projectContext + 1) }, { contextSourceUrl: "ftp://x" }]) {
      expect((await patchProject(json(body, "PATCH"), ctx("p1"))).status, Object.keys(body)[0]).toBe(400);
    }
    expect((await patchProject(json({ name: "New", color: "#fff", contextSourceUrl: "" }, "PATCH"), ctx("p1"))).status).toBe(200);
  });
  it("a person has at most 50 projects", async () => {
    await db.project.createMany({ data: Array.from({ length: CAPS.projectsPerUser - 2 }, (_, i) => ({ userId: "u1", name: `P${i}`, slug: `p${i}`, context: "" })) });
    expect((await createProject(json({ name: "The 50th" }))).status).toBe(201);
    const res = await createProject(json({ name: "The 51st" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/limit of 50 projects/);
  });
});

describe("project memory", () => {
  const fact = (text: string, pinned?: boolean) => addFact(json({ text, pinned }), ctx("p1"));
  it("a fact has a length limit", async () => {
    expect((await fact("x".repeat(CAPS.memoryText + 1))).status).toBe(400);
    expect((await fact("x".repeat(CAPS.memoryText))).status).toBe(200);
  });
  it("at most 100 facts can be pinned by hand", async () => {
    await db.projectMemory.createMany({ data: Array.from({ length: CAPS.pinnedFacts }, (_, i) => ({ projectId: "p1", userId: "u1", text: `pinned ${i}`, pinned: true })) });
    expect((await fact("one more pinned")).status).toBe(409);
    expect((await fact("unpinned is fine", false)).status).toBe(200);
  });
  it("the oldest unpinned facts are dropped past 300, pinned ones are kept", async () => {
    await db.projectMemory.create({ data: { projectId: "p1", userId: "u1", text: "keep me", pinned: true, createdAt: new Date("2020-01-01") } });
    await db.projectMemory.createMany({ data: Array.from({ length: CAPS.memoryPerProject + 5 }, (_, i) => ({ projectId: "p1", userId: "u1", text: `auto ${i}`, createdAt: new Date(2021, 0, 1, 0, 0, i) })) });
    await addMemory("u1", "p1", { kind: "lesson", text: "newest" });
    expect(await db.projectMemory.count({ where: { projectId: "p1" } })).toBe(CAPS.memoryPerProject);
    expect(await db.projectMemory.findFirst({ where: { text: "keep me" } })).not.toBeNull();
    expect(await db.projectMemory.findFirst({ where: { text: "newest" } })).not.toBeNull();
    expect(await db.projectMemory.findFirst({ where: { text: "auto 0" } })).toBeNull();
  });
});

describe("change requests on a run", () => {
  it("an instruction has a length limit (it is sent to the AI)", async () => {
    const res = await runAction(json({ instruction: "x".repeat(CAPS.instruction + 1) }), { params: Promise.resolve({ id: "r1", action: "revise" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/);
  });
});
