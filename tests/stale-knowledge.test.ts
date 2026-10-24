import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

// A project's knowledge went stale (18 Oct) while every scan since was silently discarded and the page said "up to
// date"; the estimate then called tickets, email and scheduled jobs missing. These tests pin each link of that chain.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
const gh = vi.hoisted(() => ({ files: {} as Record<string, string>, paths: [] as string[], sha: "head1", trees: 0, fail: false, hang: false }));
const ai = vi.hoisted(() => ({ prompts: [] as string[], reply: "{}" }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
vi.mock("@/lib/github/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/client")>()),
  github: {
    repoBranch: async () => { if (gh.fail) throw new Error("down"); return { sha: gh.sha, protected: false }; },
    listTree: async () => { gh.trees++; if (gh.fail) throw new Error("down"); if (gh.hang) return new Promise(() => undefined); return { paths: gh.paths, truncated: false }; },
    getFile: async (_i: number, _o: string, _r: string, p: string) => (gh.files[p] !== undefined ? { sha: "s", content: gh.files[p] } : null),
    commitsAhead: async () => 3,
    getPr: async () => ({ state: "open" }),
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: async (a: { messages: { content: string }[] }) => { ai.prompts.push(a.messages[0].content); return { content: [{ type: "text", text: ai.reply }] }; } }; },
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
process.env.ANTHROPIC_API_KEY = "sk-test";

import { db, resetDb } from "./pg";
import {
  acceptProposal, dismissProposal, fingerprint, knowledgeNotice, mergeAiSections, mergeAiSectionsDetailed, parseKnowledge, pendingProposals, sameText, setSection, assembleContext,
  type Knowledge,
} from "@/lib/knowledge";
import { buildInventory, codeFoldersFrom, routesFrom, summarizePrismaSchema, liveInventory, inventoryFiles } from "@/lib/repo-inventory";
import { snapshotRepo, pickFiles } from "@/lib/repo-snapshot";
import { buildDraftPrompt } from "@/lib/context-draft";
import { projectPromptContext } from "@/lib/project-context";
import { groundedContext } from "@/lib/project-grounding";
import { buildLearnPrompt } from "@/lib/runs/workflow";
import { GET as getKnowledge, PATCH as patchKnowledge } from "@/app/api/projects/[id]/knowledge/route";
import { GET as getFreshness } from "@/app/api/projects/[id]/freshness/route";
import { POST as estimate } from "@/app/api/ideas/[id]/estimate/route";
import { POST as quickDraft } from "@/app/api/projects/[id]/context-draft/route";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const OLD = "2026-10-01T00:00:00.000Z";
const confirmedStructure = (): Knowledge => ({
  sections: {
    structure: { text: "models User, Project, Idea, Run, ProjectMemory", source: "learn-run", status: "confirmed", updatedAt: OLD },
    stack: { text: "Next.js", source: "quick-draft", status: "needs_review", updatedAt: OLD },
  },
});

describe("a scan never changes what the owner confirmed, and never throws it away unseen", () => {
  it("turns a different finding into a suggestion and leaves the text alone", () => {
    const r = mergeAiSectionsDetailed(confirmedStructure(), { structure: "models User, Project, Idea, Run, Ticket, TicketMessage", stack: "Next.js 15" }, "learn-run");
    expect(r.knowledge.sections.structure!.text).toBe("models User, Project, Idea, Run, ProjectMemory");
    expect(r.knowledge.proposals!.structure).toMatchObject({ text: "models User, Project, Idea, Run, Ticket, TicketMessage", source: "learn-run" });
    expect(r.proposed).toEqual(["structure"]);
    expect(r.applied).toEqual(["stack"]); // an unconfirmed topic is simply updated
    expect(r.knowledge.sections.stack!.text).toBe("Next.js 15");
  });
  it("says nothing when the scan agrees (spacing and case do not count), and clears an old suggestion", () => {
    const k = { ...confirmedStructure(), proposals: { structure: { text: "something else", source: "quick-draft" as const, at: OLD } } };
    const r = mergeAiSectionsDetailed(k, { structure: "  Models   user, project, idea, run, projectmemory " }, "quick-draft");
    expect(r.unchanged).toEqual(["structure"]);
    expect(r.knowledge.proposals).toBeUndefined();
    expect(sameText("a  b", "A B")).toBe(true);
  });
  it("force still replaces everything and clears the suggestion; the old call shape still works", () => {
    const k = { ...confirmedStructure(), proposals: { structure: { text: "x", source: "quick-draft" as const, at: OLD } } };
    const forced = mergeAiSections(k, { structure: "new text" }, "quick-draft", { force: true });
    expect(forced.sections.structure!.text).toBe("new text");
    expect(forced.proposals).toBeUndefined();
    expect(mergeAiSections(confirmedStructure(), { structure: "new" }, "quick-draft").sections.structure!.text).toBe("models User, Project, Idea, Run, ProjectMemory");
  });
  it("a topic the owner writes by hand settles the suggestion", () => {
    const k = { ...confirmedStructure(), proposals: { structure: { text: "x", source: "quick-draft" as const, at: OLD } } };
    expect(pendingProposals(setSection(k, "structure", "mine", "you", "confirmed"))).toEqual([]);
  });
  it("using a suggestion takes its text and confirms it; keeping mine turns it down for good, but a different finding comes back", () => {
    const k = mergeAiSectionsDetailed(confirmedStructure(), { structure: "with tickets" }, "learn-run").knowledge;
    const used = acceptProposal(k, "structure");
    expect(used.sections.structure).toMatchObject({ text: "with tickets", status: "confirmed", source: "learn-run" });
    expect(used.proposals).toBeUndefined();
    const kept = dismissProposal(k, "structure");
    expect(kept.sections.structure!.text).toBe("models User, Project, Idea, Run, ProjectMemory");
    expect(kept.proposals).toBeUndefined();
    expect(mergeAiSectionsDetailed(kept, { structure: "with tickets" }, "learn-run").proposed).toEqual([]);
    expect(mergeAiSectionsDetailed(kept, { structure: "with tickets and billing" }, "learn-run").proposed).toEqual(["structure"]);
    expect(acceptProposal(confirmedStructure(), "structure")).toEqual(confirmedStructure()); // nothing to use: no change
  });
  it("is stored and read back, and junk is ignored; only the last five turned-down fingerprints are kept", () => {
    let k = mergeAiSectionsDetailed(confirmedStructure(), { structure: "A" }, "quick-draft").knowledge;
    expect(parseKnowledge(JSON.parse(JSON.stringify(k))).proposals!.structure!.text).toBe("A");
    for (let i = 0; i < 7; i++) { k = mergeAiSectionsDetailed(k, { structure: `finding ${i}` }, "quick-draft").knowledge; k = dismissProposal(k, "structure"); }
    expect(parseKnowledge(k).dismissed!.structure).toHaveLength(5);
    expect(parseKnowledge({ proposals: { structure: { text: 5 }, nonsense: { text: "x" } }, dismissed: { structure: "no" } })).toEqual({ sections: {} });
    expect(fingerprint("a b")).toBe(fingerprint("A   B"));
  });
  it("the AI still only reads the sections, never a suggestion, until the owner accepts it", () => {
    const k = mergeAiSectionsDetailed(confirmedStructure(), { structure: "TICKETS" }, "quick-draft").knowledge;
    expect(assembleContext(k)).not.toContain("TICKETS");
    expect(assembleContext(acceptProposal(k, "structure"))).toContain("TICKETS");
  });
});

describe("what the page says about how current the knowledge is", () => {
  it("only says it is compared with the repo once every difference is settled, and counts as stale after 20 commits", () => {
    expect(knowledgeNotice({ proposals: 2, behind: 0, learnedAt: "2026-10-24" })).toMatchObject({ level: "review" });
    expect(knowledgeNotice({ proposals: 2, behind: 0, learnedAt: "2026-10-24" }).text).toMatch(/2 topics you confirmed/);
    expect(knowledgeNotice({ proposals: 1, behind: 99, learnedAt: "x" }).level).toBe("review"); // suggestions come first
    expect(knowledgeNotice({ proposals: 0, behind: 20, learnedAt: "x" })).toMatchObject({ level: "stale" });
    expect(knowledgeNotice({ proposals: 0, behind: null, learnedAt: null }).level).toBe("stale"); // never scanned
    const ok = knowledgeNotice({ proposals: 0, behind: 1, learnedAt: "x" });
    expect(ok.level).toBe("ok");
    expect(ok.text).not.toMatch(/up.to.date/i); // the old claim
    expect(ok.text).toMatch(/Compared with the repo at the last scan/);
  });
});

describe("the knowledge page and its routes", () => {
  beforeEach(async () => {
    await resetDb();
    sess.user = { id: "ann", email: "ann@x.se" };
    await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
    await db.githubInstallation.create({ data: { userId: "ann", id: 5, repos: ["acme/app"] } });
    const k = mergeAiSectionsDetailed(confirmedStructure(), { structure: "with Ticket and TicketMessage" }, "learn-run", { now: new Date("2026-10-24T05:48:00Z") }).knowledge;
    await db.project.create({ data: { id: "p1", userId: "ann", name: "P", slug: "p", context: "x", knowledge: { ...k, learnedSha: "old", learnedAt: "2026-10-24T05:48:00.000Z" } as never, installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { prod: "main" }, defaultEnv: "prod" } });
  });
  const ctx = { params: Promise.resolve({ id: "p1" }) };
  const patch = (body: unknown) => patchKnowledge(new Request("https://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);

  it("shows the suggestion next to the confirmed text, and the notice that asks for a review", async () => {
    const j = await (await getKnowledge(new Request("https://x"), ctx)).json();
    const s = j.sections.find((x: { id: string }) => x.id === "structure");
    expect(s.text).toContain("ProjectMemory");
    expect(s.proposal.text).toBe("with Ticket and TicketMessage");
    expect(j.sections.find((x: { id: string }) => x.id === "stack").proposal).toBeNull();
    expect(j.freshness).toMatchObject({ proposals: 1, notice: { level: "review" } });
  });
  it("using the suggestion changes the text the AI reads, and the notice goes", async () => {
    expect((await patch({ section: "structure", useSuggestion: true })).status).toBe(200);
    const p = await db.project.findUnique({ where: { id: "p1" } });
    expect(p!.context).toContain("with Ticket and TicketMessage");
    expect(p!.context).not.toContain("ProjectMemory");
    const j = await (await getKnowledge(new Request("https://x"), ctx)).json();
    expect(j.freshness.proposals).toBe(0);
    expect(j.freshness.notice.level).not.toBe("review");
  });
  it("keeping mine leaves the text, removes the suggestion, and asking again for a suggestion that is gone is refused", async () => {
    expect((await patch({ section: "structure", keepMine: true })).status).toBe(200);
    const p = await db.project.findUnique({ where: { id: "p1" } });
    expect(p!.context).toContain("ProjectMemory");
    expect((await patch({ section: "structure", keepMine: true })).status).toBe(409);
    expect((await patch({ section: "structure", useSuggestion: true })).status).toBe(409);
  });
  it("only the owner can settle it", async () => {
    sess.user = { id: "bob", email: "bob@x.se" };
    await db.user.create({ data: { id: "bob", email: "bob@x.se", approved: true } });
    expect((await patch({ section: "structure", useSuggestion: true })).status).toBe(404);
  });
  it("the freshness answer carries the count and the notice for the project list and the idea page", async () => {
    const j = await (await getFreshness(new Request("https://x"), ctx)).json();
    expect(j).toMatchObject({ proposals: 1, notice: { level: "review" } });
  });
});

describe("the repo inventory", () => {
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => fs.existsSync(f));
  const schema = read("prisma/schema.prisma");

  it("lists every data model of the real schema, ticket models included, within its budget", () => {
    const out = summarizePrismaSchema(schema);
    const models = [...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]);
    expect(models.length).toBeGreaterThan(12);
    for (const m of models) expect(out, m).toContain(`model ${m}:`);
    expect(out).toMatch(/model Ticket: id,/);
    expect(out.length).toBeLessThanOrEqual(6200);
  });
  it("reads the pages and API routes from the file list alone, without route groups", () => {
    const { pages, api } = routesFrom(files);
    expect(api).toContain("/api/support/ticket/[token]");
    expect(api).toContain("/api/cron/stuck-runs");
    expect(api).toContain("/api/ideas/[id]/runs");
    expect(pages).toContain("/guide");
    expect(pages).toContain("/ideas/[id]");
    expect(pages.concat(api).some((r) => r.includes("(app)"))).toBe(false);
    expect(routesFrom(["pages/index.js", "pages/about.js", "pages/api/report.js", "pages/_app.js", "pages/blog/index.js"])).toEqual({ pages: ["/", "/about", "/blog"], api: ["/api/report"] });
  });
  it("names the code folders and what is in them", () => {
    const folders = codeFoldersFrom(files).join("\n");
    expect(folders).toMatch(/src\/lib\/support: [^\n]*form-schema/);
    expect(folders).toMatch(/src\/lib: [^\n]*billing/);
    expect(folders).not.toMatch(/\.test\./);
  });
  it("puts models, routes, libraries, scheduled jobs and workflows into one bounded text", () => {
    const inv = buildInventory({ paths: files, texts: { "prisma/schema.prisma": schema, "package.json": read("package.json"), "vercel.json": read("vercel.json") } });
    for (const needle of ["Data models", "model SupportSpace", "Pages (", "API routes (", "Code, by folder", "Libraries in package.json", "next, ", "Scheduled jobs (vercel.json)", "/api/cron/stuck-runs (30 3 * * *)", "GitHub workflows", ".github/workflows/ci.yml"]) expect(inv, needle).toContain(needle);
    expect(inv.length).toBeLessThanOrEqual(9100);
    expect(buildInventory({ paths: ["a.ts"], truncated: true, texts: {} })).toMatch(/cut short by GitHub/);
    expect(inventoryFiles(["prisma/schema.prisma", "package.json", "README.md"])).toEqual(["prisma/schema.prisma", "package.json"]);
  });

  function setRepo() {
    gh.paths = files; gh.trees = 0; gh.fail = false; gh.hang = false; gh.sha = "head1";
    gh.files = { "prisma/schema.prisma": schema, "package.json": read("package.json"), "vercel.json": read("vercel.json"), "README.md": "# Hi", ".idea-hq/KNOWLEDGE.md": "STALE SELF OUTPUT models User, Project" };
  }

  it("a scan reads the schema as an outline with every model, and never reads its own knowledge file back", async () => {
    setRepo();
    expect(pickFiles([".idea-hq/KNOWLEDGE.md", "README.md", "package.json"])).toEqual(["README.md", "package.json"]);
    const snap = await snapshotRepo(await import("@/lib/github/client").then((m) => m.github as never), 5, "acme", "app", "main");
    const s = snap.files.find((f) => f.path === "prisma/schema.prisma")!;
    expect(s.text).toContain("Outline of every model");
    expect(s.text).toContain("model Ticket:");
    expect(snap.files.map((f) => f.path)).not.toContain(".idea-hq/KNOWLEDGE.md");
    expect(snap.files.map((f) => f.text).join("")).not.toContain("STALE SELF OUTPUT");
    expect(snap.inventory).toContain("/api/support/ticket/[token]");
    const prompt = buildDraftPrompt("Idea HQ", snap);
    expect(prompt).toMatch(/<inventory-[0-9a-f]{12}>/);
    expect(prompt).toContain("never write that something is missing because it is not in the sample");
    expect(prompt).toContain("up to 300 words");
  });

  it("the estimate is given the inventory, and told that a summary that is silent proves nothing", async () => {
    setRepo();
    await resetDb();
    await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
    sess.user = { id: "ann", email: "ann@x.se" };
    await db.githubInstallation.create({ data: { userId: "ann", id: 5, repos: ["acme/app"] } });
    await db.project.create({ data: { id: "p1", userId: "ann", name: "Idea HQ", slug: "ihq", context: "## How it is organised\nmodels User, Project, Idea, Run", installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { prod: "main" }, defaultEnv: "prod" } });
    await db.idea.create({ data: { id: "i1", userId: "ann", projectId: "p1", title: "Auto-close tickets after customer silence", notes: "after N days" } });
    ai.prompts = []; ai.reply = JSON.stringify({ complexity: "S", impact: "low", scope: "Edit the existing retention job.", suggestedPriority: "low", tags: ["support"] });
    const res = await estimate(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: "i1" }) });
    expect(res.status).toBe(200);
    const prompt = ai.prompts[0];
    expect(prompt).toContain("model Ticket:");
    expect(prompt).toContain("/api/cron/stuck-runs (30 3 * * *)");
    expect(prompt).toMatch(/<repo-inventory-[0-9a-f]{12}>/);
    expect(prompt).toContain("trust the inventory");
    expect(prompt).toContain("never say that something does not exist");
    expect(prompt).toContain("Only say that something does not exist, or must be built, if the inventory shows it is not there");
  });
});

describe("the grounding for an AI call", () => {
  it("never calls a summary complete, with or without an inventory", () => {
    const p = { name: "Shop", context: "Next.js shop" };
    for (const text of [projectPromptContext(p), projectPromptContext(p, "model Ticket: id")]) {
      expect(text).toContain("NOT a complete list of what exists");
      expect(text).toContain("never say that something does not exist");
    }
    const withInv = projectPromptContext(p, "model Ticket: id");
    expect(withInv).toContain("trust the inventory");
    expect(withInv.indexOf("project-context")).toBeLessThan(withInv.indexOf("repo-inventory"));
    expect(projectPromptContext(p)).not.toContain("repo-inventory");
    expect(projectPromptContext({ name: "Shop", context: "" }, "model Ticket: id")).toContain("No summary has been written");
    expect(projectPromptContext({ name: "Shop", context: "" })).toContain("No architecture context");
  });

  const project = { name: "Idea HQ", context: "summary", installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { prod: "main" }, defaultEnv: "prod", id: "p1", userId: "ann" };
  async function client() { return (await import("@/lib/github/client")).github as never; }
  beforeEach(async () => {
    await resetDb();
    gh.paths = ["prisma/schema.prisma", "src/app/api/support/route.ts"]; gh.files = { "prisma/schema.prisma": "model Ticket {\n  id String\n}\n" }; gh.trees = 0; gh.fail = false; gh.hang = false;
    await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
    await db.githubInstallation.create({ data: { userId: "ann", id: 5, repos: ["acme/app"] } });
  });

  it("caches the inventory per commit: the same commit costs one tree request, a new commit another", async () => {
    gh.sha = "same-sha-1";
    await liveInventory(await client(), 5, "acme", "app", "main");
    await liveInventory(await client(), 5, "acme", "app", "main");
    expect(gh.trees).toBe(1);
    gh.sha = "same-sha-2";
    await liveInventory(await client(), 5, "acme", "app", "main");
    expect(gh.trees).toBe(2);
  });
  it("falls back to the summary alone when GitHub fails or is too slow, and never throws", async () => {
    gh.sha = "fail-sha"; gh.fail = true;
    expect(await groundedContext(project as never, await client())).not.toContain("repo-inventory");
    gh.fail = false; gh.hang = true; gh.sha = "slow-sha";
    expect(await liveInventory(await client(), 5, "acme", "app", "main", 50)).toBeNull();
  });
  it("is not given for a repository the person cannot open", async () => {
    gh.sha = "noaccess-sha";
    await db.githubInstallation.update({ where: { userId_id: { userId: "ann", id: 5 } }, data: { repos: ["acme/other"] } });
    expect(await groundedContext(project as never, await client())).not.toContain("repo-inventory");
    expect(gh.trees).toBe(0);
  });
  it("includes it for a project whose repository can be read", async () => {
    gh.sha = "ok-sha";
    expect(await groundedContext(project as never, await client())).toContain("model Ticket:");
  });
});

describe("a deep scan is told the repository wins", () => {
  it("does not tell the AI to keep the confirmed text, and does not let it read the old knowledge file", () => {
    const p = buildLearnPrompt("Idea HQ", confirmedStructure());
    expect(p).not.toMatch(/do not contradict them/i);
    expect(p).toContain("the repository is the truth");
    expect(p).toContain("models User, Project, Idea, Run, ProjectMemory"); // still shown, as something to check
    expect(p).toMatch(/Do NOT use \.idea-hq\/KNOWLEDGE\.md as a source/);
    expect(p).toMatch(/every data model, every feature area and every scheduled job by name/);
  });
});

describe("where the owner sees it", () => {
  it("the knowledge page has the suggestion with Use and Keep, and says plainly what a scan did", () => {
    const view = read("src/app/(app)/projects/[id]/knowledge/knowledge-view.tsx");
    for (const needle of ['data-testid="suggestion"', "Use the new text", "Keep mine", "Suggested changes to review", "last changed", "Nothing new: what you have matches", "Suggested changes to", "compared-note"]) expect(view, needle).toContain(needle);
    expect(view).not.toMatch(/Topics you have confirmed stay as you wrote them/);
  });
  it("the idea page shows the notice above the journey card, and the project list links to the review", () => {
    const detail = read("src/app/(app)/ideas/ideas-detail.tsx");
    expect(detail.indexOf('data-testid="knowledge-notice"')).toBeGreaterThan(0);
    expect(detail.indexOf('data-testid="knowledge-notice"')).toBeLessThan(detail.indexOf("<IdeaJourney"));
    expect(read("src/app/(app)/projects/projects-admin.tsx")).toContain("Review them");
  });
});

describe("a quick scan of a project whose topics were all confirmed", () => {
  it("changes none of them, keeps what it found as suggestions, says so, and still sees the whole repo", async () => {
    await resetDb();
    sess.user = { id: "ann", email: "ann@x.se" };
    await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
    await db.githubInstallation.create({ data: { userId: "ann", id: 5, repos: ["acme/app"] } });
    await db.project.create({ data: { id: "p1", userId: "ann", name: "Idea HQ", slug: "ihq", context: "x", knowledge: { ...confirmedStructure(), learnedSha: "old", learnedAt: OLD } as never, installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { prod: "main" }, defaultEnv: "prod", workflowInstalled: true } });
    gh.paths = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => fs.existsSync(f));
    gh.files = { "prisma/schema.prisma": read("prisma/schema.prisma"), "package.json": read("package.json"), "vercel.json": read("vercel.json"), README: "" };
    gh.sha = "scan-head"; gh.fail = false; gh.hang = false;
    ai.prompts = []; ai.reply = JSON.stringify({ structure: "models User, Project, Idea, Run, Ticket, TicketMessage, SupportSpace", what: "A backlog tool." });
    const res = await quickDraft(new Request("https://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result).toMatchObject({ proposed: 1, applied: 1 }); // structure was confirmed: a suggestion; "what" was empty: filled in
    const p = await db.project.findUnique({ where: { id: "p1" } });
    const k = parseKnowledge(p!.knowledge);
    expect(k.sections.structure!.text).toBe("models User, Project, Idea, Run, ProjectMemory");
    expect(k.proposals!.structure!.text).toContain("Ticket");
    expect(k.learnedSha).toBe("scan-head");
    expect(p!.context).not.toContain("SupportSpace");
    expect(ai.prompts[0]).toContain("model SupportSpace:"); // the whole schema reached the AI, not its first 6,000 characters
    expect(ai.prompts[0]).toContain("/api/support/ticket/[token]");
    // and the page now says there is something to review, not that it is up to date
    const page = await (await getKnowledge(new Request("https://x"), { params: Promise.resolve({ id: "p1" }) })).json();
    expect(page.freshness.notice.level).toBe("review");
  });
});
