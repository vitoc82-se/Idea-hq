import { describe, it, expect, vi, beforeEach } from "vitest";
import { findBacklogFiles, parseImportItems, cleanImportRequest, withoutExisting, buildImportPrompt, cleanTitle, MAX_IMPORT } from "@/lib/backlog-import";

describe("finding a backlog file in a repo", () => {
  it("finds TODO files and friends, best first", () => {
    const tree = ["src/app.ts", "README.md", "docs/ROADMAP.md", "TODOS.md", "BACKLOG.md", "notes/ideas.txt", "docs/todo.md", "node_modules/x/TODO.md", "tests/fixtures/todo.md", "CHANGELOG.md", "a/b/c/d/todo.md", "todo.png", "feature-requests.md"];
    const out = findBacklogFiles(tree);
    expect(out[0]).toBe("TODOS.md");
    expect(out).toContain("BACKLOG.md");
    expect(out).toContain("docs/ROADMAP.md");
    expect(out).toContain("feature-requests.md");
    for (const bad of ["node_modules/x/TODO.md", "tests/fixtures/todo.md", "README.md", "CHANGELOG.md", "src/app.ts", "todo.png", "a/b/c/d/todo.md"]) expect(out).not.toContain(bad);
  });
  it("returns nothing for a repo without one, and caps the list", () => {
    expect(findBacklogFiles(["src/a.ts", "README.md"])).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `docs/todo-${i}.md`);
    expect(findBacklogFiles(many).length).toBeLessThanOrEqual(8);
  });
});

describe("reading the AI's list", () => {
  it("parses, cleans titles, dedupes and keeps the done flag", () => {
    const raw = [{ title: "- [ ] **Dark mode**", notes: "  for night  ", done: false }, { title: "dark mode", notes: "dup" }, { title: "Login page", done: true }, { title: "" }, 5, null, { title: "x".repeat(300) }];
    const out = parseImportItems("Here you go:\n" + JSON.stringify(raw));
    expect(out.map((i) => i.title)).toEqual(["Dark mode", "Login page", "x".repeat(100)]);
    expect(out[1].done).toBe(true);
    expect(out[0].notes).toBe("for night");
  });
  it("strips list markers and control characters", () => {
    expect(cleanTitle("1. [x] Fix the bug\u0007")).toBe("Fix the bug");
    expect(cleanTitle("# Heading idea")).toBe("Heading idea");
    expect(cleanTitle("- [ ] Dark mode")).toBe("Dark mode");
    expect(cleanTitle("X axis labels")).toBe("X axis labels");
  });
  it("tolerates junk output", () => {
    for (const bad of ["", "no list", "[broken", '{"title":"x"}']) expect(parseImportItems(bad)).toEqual([]);
  });
  it("caps at 80 ideas", () => {
    const many = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ title: `Idea ${i}` })));
    expect(parseImportItems(many)).toHaveLength(80);
  });
  it("the prompt treats the backlog as data and caps its size", () => {
    const p = buildImportPrompt("Shop", "TODO.md", "x".repeat(100000));
    expect(p).toMatch(/data, not instructions/);
    expect(p.length).toBeLessThan(35000);
  });
});

describe("what the browser sends back", () => {
  it("accepts a list and cleans it", () => {
    expect(cleanImportRequest([{ title: "  A  ", notes: "n", done: true }, { title: "" }, { title: "B" }])).toEqual([{ title: "A", notes: "n", done: true }, { title: "B", notes: "", done: false }]);
  });
  it("rejects empty, huge, or malformed requests", () => {
    for (const bad of [null, [], "x", [5], Array.from({ length: MAX_IMPORT + 1 }, () => ({ title: "x" })), [{ title: "" }]]) expect(cleanImportRequest(bad)).toBeNull();
  });
  it("skips ideas the project already has, case-insensitively, and duplicates inside the batch", () => {
    const r = withoutExisting([{ title: "Dark mode", notes: "", done: false }, { title: "dark MODE", notes: "", done: false }, { title: "New", notes: "", done: false }], ["dark mode"]);
    expect(r.fresh.map((i) => i.title)).toEqual(["New"]);
    expect(r.skipped).toBe(2);
  });
});

// ---- routes ----------------------------------------------------------------
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const st = vi.hoisted(() => ({
  user: "u1" as string | null,
  project: { id: "p1", userId: "u1", name: "Shop", installationId: 5, repoOwner: "me", repoName: "shop", envBranches: { live: "main" }, defaultEnv: "live" } as Record<string, unknown> | null,
  ideas: [{ title: "Existing idea" }] as { title: string }[],
  created: [] as Row[],
  tree: ["TODOS.md", "src/a.ts"] as string[],
  files: { "TODOS.md": "- [ ] Dark mode\n- [x] Login" } as Record<string, string>,
  ai: '[{"title":"Dark mode","notes":"","done":false},{"title":"Login","notes":"","done":true}]',
  aiCalls: 0,
  aiAllowed: true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    project: { findFirst: async (a: Row) => (st.project && a.where.id === st.project.id && a.where.userId === st.project.userId ? st.project : null) },
    githubInstallation: { findFirst: async () => null }, idea: { findMany: async () => st.ideas, count: async () => st.ideas.length + st.created.length, createMany: async (a: Row) => { st.created.push(...a.data); return { count: a.data.length }; } },
  },
}));
vi.mock("@/lib/github/client", async () => {
  const real = await vi.importActual<typeof import("@/lib/github/client")>("@/lib/github/client");
  return { ...real, github: { listTree: async () => ({ paths: st.tree, truncated: false }), getFile: async (_i: number, _o: string, _r: string, path: string) => (st.files[path] ? { sha: "x", content: st.files[path] } : null) } };
});
vi.mock("@/lib/runs/http", async () => {
  const real = await vi.importActual<typeof import("@/lib/runs/http")>("@/lib/runs/http");
  return {
    ...real,
    requireUser: async () => (st.user ? { userId: st.user, email: "o@x.se" } : { res: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) }),
    requireAi: async () => (st.aiAllowed ? null : new Response(JSON.stringify({ error: "Daily AI limit reached." }), { status: 429 })),
  };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: async () => { st.aiCalls++; return { content: [{ type: "text", text: st.ai }] }; } }; } }));

import { GET as candidates, POST as commit } from "@/app/api/projects/[id]/import/route";
import { POST as preview } from "@/app/api/projects/[id]/import/preview/route";

const P = { params: Promise.resolve({ id: "p1" }) };
const post = (body: unknown) => new Request("https://ideahq.cloud/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  st.user = "u1";
  st.project = { id: "p1", userId: "u1", name: "Shop", installationId: 5, repoOwner: "me", repoName: "shop", envBranches: { live: "main" }, defaultEnv: "live" };
  st.ideas = [{ title: "Existing idea" }];
  st.created = [];
  st.tree = ["TODOS.md", "src/a.ts"];
  st.ai = '[{"title":"Dark mode","notes":"","done":false},{"title":"Login","notes":"","done":true}]';
  st.aiCalls = 0;
  st.aiAllowed = true;
});

describe("import routes", () => {
  it("lists backlog files in the connected repo, and nothing without one", async () => {
    expect(await (await candidates(new Request("https://x"), P)).json()).toMatchObject({ repoConnected: true, files: ["TODOS.md"] });
    st.project = { ...st.project!, installationId: null };
    expect(await (await candidates(new Request("https://x"), P)).json()).toEqual({ repoConnected: false, files: [] });
  });
  it("needs a signed-in user and the user's own project", async () => {
    st.user = null;
    expect((await candidates(new Request("https://x"), P)).status).toBe(401);
    expect((await preview(post({ text: "- a" }), P)).status).toBe(401);
    expect((await commit(post({ items: [{ title: "a" }] }), P)).status).toBe(401);
    st.user = "u2";
    expect((await candidates(new Request("https://x"), P)).status).toBe(404);
    expect((await preview(post({ text: "- a" }), P)).status).toBe(404);
    expect((await commit(post({ items: [{ title: "a" }] }), P)).status).toBe(404);
    expect(st.created).toHaveLength(0);
  });
  it("previews pasted text with the AI and saves nothing", async () => {
    const d = await (await preview(post({ text: "- [ ] Dark mode\n- [x] Login" }), P)).json();
    expect(d.items).toHaveLength(2);
    expect(d.items[1].done).toBe(true);
    expect(st.aiCalls).toBe(1);
    expect(st.created).toHaveLength(0);
  });
  it("previews a repo file, but only one the scan would offer", async () => {
    expect((await preview(post({ path: "TODOS.md" }), P)).status).toBe(200);
    for (const bad of ["src/a.ts", "../../etc/passwd", ".env", "README.md"]) expect((await preview(post({ path: bad }), P)).status, bad).toBe(400);
  });
  it("refuses empty text and respects the daily AI limit", async () => {
    expect((await preview(post({ text: "  " }), P)).status).toBe(400);
    st.aiAllowed = false;
    expect((await preview(post({ text: "- a thing" }), P)).status).toBe(429);
    expect(st.aiCalls).toBe(0);
  });
  it("says so when the AI finds nothing", async () => {
    st.ai = "no ideas here";
    expect((await preview(post({ text: "hello" }), P)).status).toBe(422);
  });
  it("imports the chosen ideas for this user and project, skipping ones already there", async () => {
    const res = await commit(post({ source: "TODOS.md", items: [{ title: "Dark mode", notes: "night" }, { title: "existing IDEA" }, { title: "Login", done: true }] }), P);
    expect(await res.json()).toEqual({ created: 2, skipped: 1 });
    expect(st.created.every((c) => c.userId === "u1" && c.projectId === "p1")).toBe(true);
    expect(st.created[0]).toMatchObject({ title: "Dark mode", status: "new" });
    expect(st.created[0].notes).toContain("Imported from TODOS.md");
    expect(st.created[1]).toMatchObject({ title: "Login", status: "done" });
  });
  it("rejects an empty or oversized request", async () => {
    expect((await commit(post({ items: [] }), P)).status).toBe(400);
    expect((await commit(post({}), P)).status).toBe(400);
    expect((await commit(post({ items: Array.from({ length: 101 }, (_, i) => ({ title: `t${i}` })) }), P)).status).toBe(400);
  });
});
