import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Some changes only work once the owner has done something the AI cannot: set a new environment variable, change a
// setting on the host. Those steps come from the plan, from the AI that built the change, and from Idea HQ reading the
// change itself; they are a checklist before Merge, and an idea stays open after Ship until they are done.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
const ai = vi.hoisted(() => ({ prompts: [] as string[], reply: "" }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: async (a: { messages: { content: string }[] }) => { ai.prompts.push(a.messages[0].content); return { content: [{ type: "text", text: ai.reply }] }; } }; },
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";
process.env.ANTHROPIC_API_KEY = "sk-test";

import { db, resetDb } from "./pg";
import { PATCH as patchIdea } from "@/app/api/ideas/[id]/route";
import { POST as plan } from "@/app/api/ideas/[id]/plan/route";
import { syncOwnerSteps } from "@/lib/runs/owner-steps-sync";
import type { GitHubApi } from "@/lib/github/client";
import {
  envStepsFromChanges, helpFor, mergeSteps, namesInEnvExample, newEnvNames, parseBuildSteps, readSteps, setStepState, splitPlanSteps, stepId, withoutStepsBlock, stepsLeft, stepsLeftBefore,
  type OwnerStep,
} from "@/lib/runs/owner-steps";
import { boardNext, closureNoteFor, journeyFor, needsYou, needsYouRank } from "@/lib/runs/journey";
import { buildPrompt } from "@/lib/runs/workflow";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const ctx = { params: Promise.resolve({ id: "i1" }) };
const patch = (body: unknown) => patchIdea(new Request("https://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const step = (source: OwnerStep["source"], when: OwnerStep["when"], text: string, done = false): OwnerStep => ({ id: stepId(source, text), text, when, source, done });
const patchOf = (name: string, lines: string[]) => ({ name, patch: `@@ -1,3 +1,4 @@\n${lines.join("\n")}` });

describe("what the AI says the owner has to do", () => {
  it("reads the OWNER STEPS block at the start of its final message", () => {
    const note = "OWNER STEPS\nBEFORE MERGE: Add the environment variable RESEND_API_KEY on Vercel.\nAFTER MERGE: Send yourself a test email\n  and check it arrives.\n\nI added the email job and tests.";
    const s = parseBuildSteps(note)!;
    expect(s.map((x) => [x.when, x.source])).toEqual([["before", "ai"], ["after", "ai"]]);
    expect(s[0].text).toBe("Add the environment variable RESEND_API_KEY on Vercel.");
    expect(s[1].text).toBe("Send yourself a test email and check it arrives."); // a wrapped line joins the step above
  });
  it("understands bullets, bold and a header with a colon", () => {
    const s = parseBuildSteps("**OWNER STEPS:**\n- **BEFORE MERGE:** Set `API_URL` in your host.\n- After merge: open the page.")!;
    expect(s).toHaveLength(2);
    expect(s[0].text).toBe("Set API_URL in your host.");
    expect(s[1].when).toBe("after");
  });
  it("tells none from no block at all (a revision that says nothing must not wipe the list)", () => {
    expect(parseBuildSteps("OWNER STEPS: none\nDone.")).toEqual([]);
    expect(parseBuildSteps("OWNER STEPS\nnone")).toEqual([]); // "none" on the next line says it too
    expect(parseBuildSteps("I changed two files and ran the tests.")).toBeNull();
    expect(parseBuildSteps(null)).toBeNull();
  });
  it("caps the number and the length of steps", () => {
    const many = ["OWNER STEPS", ...Array.from({ length: 40 }, (_, i) => `BEFORE MERGE: step number ${i} do the thing`)].join("\n");
    expect(parseBuildSteps(many)!.length).toBeLessThanOrEqual(20);
    expect(parseBuildSteps(`OWNER STEPS\nBEFORE MERGE: ${"x".repeat(5000)}`)![0].text.length).toBeLessThanOrEqual(600);
  });
});

describe("quoting what the AI said", () => {
  const note = "OWNER STEPS\nBEFORE MERGE: Add RESEND_API_KEY on your host.\n  It is in your Resend settings.\nAFTER MERGE: Send a test.\n\nAdded the welcome email job and two tests.";
  it("leaves out the steps block, which the checklist shows", () => {
    expect(withoutStepsBlock(note)).toBe("Added the welcome email job and two tests.");
    expect(withoutStepsBlock("OWNER STEPS: none\nAdded a footer link.")).toBe("Added a footer link.");
    expect(withoutStepsBlock("Added a footer link.")).toBe("Added a footer link.");
  });
  it("so the closing note starts with what changed", () => {
    expect(closureNoteFor(note, 7, "r1")).toBe("Added the welcome email job and two tests. Shipped in PR #7.");
  });
});

describe("what the plan says the owner has to do", () => {
  const body = "# Add emails\n\n## Change\n1. Do it.\n\n## Steps only you can do\n- BEFORE MERGE: Add RESEND_API_KEY to your host.\n- AFTER MERGE: Send a test email.\n\n_Written after reading: a.ts_";
  it("takes the section out of the brief and returns it as steps", () => {
    const r = splitPlanSteps(body);
    expect(r.steps.map((s) => [s.when, s.source])).toEqual([["before", "plan"], ["after", "plan"]]);
    expect(r.plan).not.toContain("Steps only you can do");
    expect(r.plan).not.toContain("RESEND_API_KEY");
    expect(r.plan).toContain("## Change");
    expect(r.plan).toContain("_Written after reading: a.ts_");
  });
  it("handles none, and a plan with no such section", () => {
    expect(splitPlanSteps("# X\n\n## Change\n1. a\n\n## Steps only you can do\nnone")).toMatchObject({ steps: [], plan: "# X\n\n## Change\n1. a" });
    expect(splitPlanSteps("# X\n\n## Change\n1. a")).toEqual({ plan: "# X\n\n## Change\n1. a", steps: [] });
  });
});

describe("new environment variables found in a change", () => {
  it("flags a name an added line reads for the first time", () => {
    const files = [patchOf("src/lib/email.ts", [" import x from 'y';", "+const key = process.env.RESEND_API_KEY;", "+const from = process.env['WELCOME_FROM'];"])];
    expect(newEnvNames(files, [])).toEqual(["RESEND_API_KEY", "WELCOME_FROM"]);
  });
  it("does not flag what the project already documents, or uses in code around the change", () => {
    const files = [patchOf("src/a.ts", [" const db = process.env.DATABASE_URL;", "-const old = process.env.OLD_KEY;", "+const a = process.env.DATABASE_URL;", "+const b = process.env.OLD_KEY;", "+const c = process.env.DOCUMENTED;"])];
    expect(newEnvNames(files, ["DOCUMENTED"])).toEqual([]);
  });
  it("ignores the platform's own variables, lower case names, tests, docs and .env files", () => {
    const files = [
      patchOf("src/a.ts", ["+const e = process.env.NODE_ENV; const v = process.env.VERCEL_URL; const l = process.env.some_thing;"]),
      patchOf("tests/a.test.ts", ["+process.env.ONLY_IN_TESTS = 'x';"]),
      patchOf("docs/setup.md", ["+Set process.env.IN_DOCS"]),
      patchOf(".env.example", ["+NEW_VAR="]),
    ];
    expect(newEnvNames(files, [])).toEqual([]);
  });
  it("reads other languages too, and counts NEXT_PUBLIC_ names", () => {
    const files = [patchOf("app.py", ['+k = os.environ["STRIPE_KEY"]', '+j = os.getenv("JWT_SECRET")']), patchOf("web/a.ts", ["+const u = process.env.NEXT_PUBLIC_API_URL; const m = import.meta.env.VITE_MAP_KEY;"])];
    expect(newEnvNames(files, [])).toEqual(["JWT_SECRET", "NEXT_PUBLIC_API_URL", "STRIPE_KEY", "VITE_MAP_KEY"]);
  });
  it("reads the names in a .env.example", () => {
    expect(namesInEnvExample("# Database\nDATABASE_URL=\nexport API_KEY=abc\n# OPTIONAL_THING=1\nnot a name = 1")).toEqual(["DATABASE_URL", "API_KEY", "OPTIONAL_THING"]);
  });
  it("makes a plain 'check this' step for each, worded as a check not a certainty", () => {
    const s = envStepsFromChanges([patchOf("a.ts", ["+process.env.WELCOME_FROM"])], []);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ source: "code", when: "before", done: false });
    expect(s[0].text).toMatch(/Check that the setting WELCOME_FROM exists/);
    expect(s[0].text).toMatch(/Not needed/);
  });
});

describe("keeping the list", () => {
  it("replaces a source's steps but keeps the ticks of steps that are still there", () => {
    const old = [{ ...step("ai", "before", "Add KEY_A."), done: true, doneAt: "2026-10-24T10:00:00.000Z" }, step("plan", "after", "Test it."), step("ai", "before", "Old thing.")];
    const merged = mergeSteps(old, [step("ai", "before", "Add KEY_A."), step("ai", "after", "New thing.")], ["ai"]);
    expect(merged.map((s) => s.text)).toEqual(["Test it.", "Add KEY_A.", "New thing."]);
    expect(merged.find((s) => s.text === "Add KEY_A.")).toMatchObject({ done: true, doneAt: "2026-10-24T10:00:00.000Z" });
  });
  it("drops a code-found variable the AI or the plan already named, so it is not listed twice", () => {
    const code = envStepsFromChanges([patchOf("a.ts", ["+process.env.RESEND_API_KEY; process.env.OTHER_KEY;"])], []);
    const merged = mergeSteps([], [step("ai", "before", "Add the environment variable RESEND_API_KEY on Vercel."), ...code], ["ai", "code"]);
    expect(merged.map((s) => s.source)).toEqual(["ai", "code"]);
    expect(merged[1].text).toContain("OTHER_KEY");
  });
  it("ticks, marks Not needed, and reopens; an unknown id changes nothing", () => {
    const s = [step("ai", "before", "A."), step("ai", "after", "B.")];
    const a = setStepState(s, s[0].id, "done", new Date("2026-10-24T09:00:00Z"))!;
    expect(a[0]).toMatchObject({ done: true, doneAt: "2026-10-24T09:00:00.000Z" });
    const b = setStepState(a, s[0].id, "skipped")!;
    expect(b[0]).toMatchObject({ done: true, skipped: true });
    const c = setStepState(b, s[0].id, "open")!;
    expect(c[0].done).toBe(false);
    expect(c[0].skipped).toBeUndefined();
    expect(setStepState(s, "nope", "done")).toBeNull();
    expect(stepsLeft(a).map((x) => x.text)).toEqual(["B."]);
    expect(stepsLeftBefore(a)).toEqual([]);
  });
  it("trusts nothing it reads back from the database", () => {
    expect(readSteps(null)).toEqual([]);
    expect(readSteps("x")).toEqual([]);
    expect(readSteps([{ id: 1 }, null, { id: "a", text: "Do it.", when: "later", source: "weird", done: "yes" }])).toEqual([{ id: "a", text: "Do it.", when: "before", source: "ai", done: false }]);
  });
  it("gives plain-words help, with the full walk-through for an environment variable", () => {
    const env = helpFor("Add the environment variable RESEND_API_KEY on your host.");
    expect(env.title).toMatch(/environment variable/);
    const all = env.steps.join(" ");
    expect(all).toMatch(/Vercel/);
    expect(all).toMatch(/Netlify/);
    expect(all).toMatch(/Redeploy/);
    expect(all).toMatch(/Never paste a key into Idea HQ/);
    expect(helpFor("Send a test email.").title).toBe("How to do this step");
  });
});

describe("the journey and the board", () => {
  const idea = { title: "T", complexity: "S", plan: "p", status: "building" };
  const run = (status: string, o = {}) => ({ id: "r", kind: "implement", status, checksState: "green", prNumber: 1, ...o });
  const epic = null;
  const access = { aiBuild: true, needsPlan: false, capReached: null };
  it("tells the owner at Review to do the steps first, and still offers Merge", () => {
    const v = journeyFor({ idea, run: run("pr_open"), epic, access, recommended: null, reportsCost: false, stepsOpen: 2, stepsOpenBefore: 2 });
    expect(v.headline).toBe("Build and tests passed. Do 2 setup steps first (below), then merge.");
    expect(v.primary).toMatchObject({ action: "merge" });
    expect(journeyFor({ idea, run: run("pr_open"), epic, access, recommended: null, reportsCost: false, stepsOpen: 1, stepsOpenBefore: 0 }).headline).toBe("Build and tests passed. Read the change, then merge it.");
  });
  it("does not call a merged idea finished while steps are open", () => {
    const v = journeyFor({ idea: { ...idea, status: "done" }, run: run("merged"), epic, access, recommended: null, reportsCost: false, stepsOpen: 1 });
    expect(v).toMatchObject({ stage: "ship", headline: "Merged, but it will not work until you finish 1 setup step.", primary: { action: "finish", label: "Do the setup step" } });
    expect(journeyFor({ idea: { ...idea, status: "done" }, run: run("merged"), epic, access, recommended: null, reportsCost: false, stepsOpen: 0 }).primary).toMatchObject({ action: "home" });
  });
  it("puts such an idea under Needs you, right after finished work waiting to be merged", () => {
    const n = boardNext({ idea: { ...idea, status: "done" }, run: { status: "merged" }, epic, stepsOpen: 3 });
    expect(n).toMatchObject({ stage: "ship", action: "finish", next: "Finish 3 setup steps" });
    expect(needsYou(n)).toBe(true);
    const merge = boardNext({ idea, run: { status: "pr_open", checksState: "green" }, epic });
    const fix = boardNext({ idea, run: { status: "pr_open", checksState: "red" }, epic });
    expect(needsYouRank(merge)).toBeLessThan(needsYouRank(n));
    expect(needsYouRank(n)).toBeLessThan(needsYouRank(fix));
    expect(boardNext({ idea: { ...idea, status: "done" }, run: { status: "merged" }, epic })).toMatchObject({ next: "Done: merged", action: null });
  });
});

describe("where the steps come from and go", () => {
  beforeEach(async () => {
    await resetDb();
    ai.prompts = [];
    sess.user = { id: "ann", email: "ann@x.se" };
    await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
    await db.user.create({ data: { id: "bob", email: "bob@x.se", approved: true } });
    await db.project.create({ data: { id: "p1", userId: "ann", name: "Idea HQ", slug: "ihq", context: "Next.js app" } });
    await db.idea.create({ data: { id: "i1", userId: "ann", projectId: "p1", title: "Welcome email", notes: "send one", complexity: "S", impact: "low" } });
  });
  const stored = async () => readSteps((await db.idea.findUnique({ where: { id: "i1" } }))!.ownerSteps);

  it("the plan route asks for the steps, keeps them off the brief, and stores them", async () => {
    ai.reply = "# Welcome email\n\n## Change\n1. Send it.\n\n## Steps only you can do\n- BEFORE MERGE: Add RESEND_API_KEY to your host.";
    const res = await plan(new Request("https://x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(ai.prompts[0]).toContain("## Steps only you can do");
    expect(ai.prompts[0]).toMatch(/never write a value/);
    const i = await db.idea.findUnique({ where: { id: "i1" } });
    expect(i!.plan).not.toContain("RESEND_API_KEY");
    expect(readSteps(i!.ownerSteps)).toHaveLength(1);
    expect(readSteps(i!.ownerSteps)[0]).toMatchObject({ source: "plan", when: "before", done: false });
  });
  it("planning again keeps what the owner already ticked", async () => {
    ai.reply = "# W\n\n## Steps only you can do\n- BEFORE MERGE: Add RESEND_API_KEY to your host.";
    await plan(new Request("https://x", { method: "POST" }), ctx);
    const s = (await stored())[0];
    expect((await patch({ ownerStep: { id: s.id, state: "done" } })).status).toBe(200);
    await plan(new Request("https://x", { method: "POST" }), ctx);
    expect((await stored())[0]).toMatchObject({ id: s.id, done: true });
  });
  it("ticking works only on the owner's own idea, only for a real step", async () => {
    await db.idea.update({ where: { id: "i1" }, data: { ownerSteps: [step("ai", "before", "A.")] } });
    const id = (await stored())[0].id;
    expect((await patch({ ownerStep: { id: "nope", state: "done" } })).status).toBe(400);
    expect((await patch({ ownerStep: { id, state: "weird" } })).status).toBe(400);
    const ok = await patch({ ownerStep: { id, state: "skipped" } });
    expect(ok.status).toBe(200);
    expect(readSteps((await ok.json()).ownerSteps)[0]).toMatchObject({ done: true, skipped: true });
    sess.user = { id: "bob", email: "bob@x.se" };
    expect((await patch({ ownerStep: { id, state: "open" } })).status).toBe(404);
    expect((await stored())[0].done).toBe(true);
  });

  const gh = (files: { name: string; patch: string | null }[], envExample: string | null, fail = false) => ({
    prPatches: async () => { if (fail) throw new Error("down"); return files; },
    getFile: async (_i: number, _o: string, _r: string, p: string) => (p === ".env.example" && envExample !== null ? { sha: "s", content: envExample } : null),
  }) as unknown as GitHubApi;
  const where = (note: string | null) => ({ ideaId: "i1", i: 1, owner: "o", repo: "r", prNumber: 3, baseRef: "main", note });

  it("a finished build adds what the AI said and what the code shows, once", async () => {
    const files = [patchOf("src/a.ts", ["+const k = process.env.RESEND_API_KEY; const d = process.env.DATABASE_URL; const f = process.env.WELCOME_FROM;"])];
    const note = "OWNER STEPS\nBEFORE MERGE: Add the environment variable RESEND_API_KEY on your host.\n\nDone.";
    await syncOwnerSteps(where(note), gh(files, "DATABASE_URL=\n"));
    const s = await stored();
    expect(s.map((x) => x.source)).toEqual(["ai", "code"]);
    expect(s[1].text).toContain("WELCOME_FROM"); // RESEND_API_KEY is already named by the AI, DATABASE_URL is documented
    await syncOwnerSteps(where(note), gh(files, "DATABASE_URL=\n")); // the same run again changes nothing
    expect((await stored()).length).toBe(2);
  });
  it("a revision that says nothing about steps keeps the list, and a failed read keeps the code steps", async () => {
    const files = [patchOf("src/a.ts", ["+const f = process.env.WELCOME_FROM;"])];
    await syncOwnerSteps(where("OWNER STEPS\nAFTER MERGE: Send a test email."), gh(files, null));
    const before = await stored();
    expect(before.map((x) => x.source)).toEqual(["ai", "code"]);
    await syncOwnerSteps(where("Fixed the typo."), gh([], null, true));
    expect(await stored()).toEqual(before);
    await syncOwnerSteps(where("OWNER STEPS: none"), gh([], null, true)); // the AI now says none: its steps go, the unreadable code check keeps its own
    expect((await stored()).map((x) => x.source)).toEqual(["code"]);
  });
  it("never throws, whatever GitHub does", async () => {
    await expect(syncOwnerSteps({ ...where(null), ideaId: "missing" }, gh([], null))).resolves.toBeUndefined();
  });
});

describe("what the building AI is told", () => {
  it("the build prompt asks for the OWNER STEPS block first and never a secret value", () => {
    const p = buildPrompt({ plan: "# Do it", ideaTitle: "T" });
    expect(p).toContain("OWNER STEPS");
    expect(p).toContain("VERY START of your final message");
    expect(p).toMatch(/NEVER a secret value/);
    expect(p).toContain(".env.example");
  });
});

describe("what the owner sees", () => {
  it("the checklist is wired into the card, the merge asks first, and the board counts open steps", () => {
    const card = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(card).toContain("<OwnerStepsBox");
    expect(card).toMatch(/window\.confirm\(`You have not done \$\{stepsWord\(open\)\} that should be done before you merge/);
    const box = read("src/app/(app)/ideas/owner-steps-box.tsx");
    for (const t of ["Before you merge", "After you merge", "Meant for before the merge", "Now that it is live", "Not needed", "How do I do this?", 'type="checkbox"', 'data-testid="owner-steps"']) expect(box).toContain(t);
    expect(read("src/app/(app)/ideas/ideas-board.tsx")).toContain("stepsOpen:");
  });
});
