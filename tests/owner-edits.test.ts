import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// The scope and the build prompt are the AI's words about an idea, and the build follows them. The owner can change
// both by hand and tell the AI what it got wrong; neither is replaced behind their back.
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
import { POST as estimate } from "@/app/api/ideas/[id]/estimate/route";
import { POST as plan } from "@/app/api/ideas/[id]/plan/route";
import { correctionsBlock, scopeLine } from "@/lib/runs/owner-edits";
import { ideaBlock } from "@/lib/runs/plan-prompt";
import { CAPS } from "@/lib/caps";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const ctx = { params: Promise.resolve({ id: "i1" }) };
const patch = (body: unknown) => patchIdea(new Request("https://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const post = (fn: typeof estimate, body?: unknown) => fn(new Request("https://x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
const get = () => db.idea.findUnique({ where: { id: "i1" } });

beforeEach(async () => {
  await resetDb();
  ai.prompts = [];
  sess.user = { id: "ann", email: "ann@x.se" };
  await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } });
  await db.user.create({ data: { id: "bob", email: "bob@x.se", approved: true } });
  await db.project.create({ data: { id: "p1", userId: "ann", name: "Idea HQ", slug: "ihq", context: "Next.js app" } });
  await db.idea.create({ data: { id: "i1", userId: "ann", projectId: "p1", title: "Auto-close tickets", notes: "after N days", scope: "AI wrote this scope.", aiEstimatedAt: new Date("2026-10-01"), plan: "AI wrote this plan.", plannedAt: new Date("2026-10-02"), complexity: "L", impact: "low" } });
});

describe("changing the scope, the build prompt and the corrections by hand", () => {
  it("remembers that the owner wrote the scope, and an empty save clears it and the mark", async () => {
    expect((await patch({ scope: "  My scope.  " })).status).toBe(200);
    let i = await get();
    expect(i!.scope).toBe("My scope.");
    expect(i!.scopeEditedAt).toBeInstanceOf(Date);
    expect(i!.plan).toBe("AI wrote this plan."); // the other texts are untouched
    expect(i!.planEditedAt).toBeNull();
    await patch({ scope: "   " });
    i = await get();
    expect(i!.scope).toBeNull();
    expect(i!.scopeEditedAt).toBeNull();
  });
  it("remembers that the owner changed the build prompt, keeps when it was first planned, and clears on empty", async () => {
    await patch({ plan: "# Fix: my own brief" });
    let i = await get();
    expect(i).toMatchObject({ plan: "# Fix: my own brief" });
    expect(i!.planEditedAt).toBeInstanceOf(Date);
    expect(i!.plannedAt).toEqual(new Date("2026-10-02"));
    await patch({ plan: "" });
    i = await get();
    expect(i!.plan).toBeNull();
    expect(i!.planEditedAt).toBeNull();
    expect(i!.plannedAt).toBeNull();
  });
  it("keeps the corrections, trimmed, and an unrelated change touches none of the marks", async () => {
    await patch({ corrections: "  The settings screen exists.  ", scope: "Mine" });
    await patch({ priority: "high", title: "Renamed" });
    const i = await get();
    expect(i).toMatchObject({ corrections: "The settings screen exists.", scope: "Mine", priority: "high" });
    expect(i!.scopeEditedAt).toBeInstanceOf(Date);
    await patch({ corrections: "" });
    expect((await get())!.corrections).toBeNull();
  });
  it("has limits, and is only for the owner of the idea", async () => {
    expect((await patch({ scope: "x".repeat(CAPS.scope + 1) })).status).toBe(400);
    expect((await patch({ plan: "x".repeat(CAPS.plan + 1) })).status).toBe(400);
    expect((await patch({ corrections: "x".repeat(CAPS.corrections + 1) })).status).toBe(400);
    expect((await patch({ plan: "x".repeat(CAPS.plan) })).status).toBe(200);
    sess.user = { id: "bob", email: "bob@x.se" };
    expect((await patch({ scope: "not yours" })).status).toBe(404);
  });
});

describe("estimating again", () => {
  const reply = (scope = "A brand new AI scope.") => { ai.reply = JSON.stringify({ complexity: "S", impact: "high", scope, suggestedPriority: "low", tags: ["support"] }); };

  it("replaces a scope the AI wrote, as before", async () => {
    reply();
    expect((await post(estimate)).status).toBe(200);
    expect(await get()).toMatchObject({ scope: "A brand new AI scope.", complexity: "S", impact: "high", scopeEditedAt: null });
  });
  it("keeps a scope the owner wrote and only re-sizes from it, telling the AI so", async () => {
    await patch({ scope: "Fold it into the retention job. Close as resolved." });
    reply("kept");
    expect((await post(estimate)).status).toBe(200);
    const i = await get();
    expect(i).toMatchObject({ scope: "Fold it into the retention job. Close as resolved.", complexity: "S", impact: "high" });
    expect(i!.scopeEditedAt).toBeInstanceOf(Date);
    expect(ai.prompts[0]).toContain("The owner wrote this scope themselves");
    expect(ai.prompts[0]).toContain("Fold it into the retention job");
  });
  it("writes a new scope over the owner's only when asked to", async () => {
    await patch({ scope: "Mine" });
    reply();
    await post(estimate, { replaceEdited: true });
    expect(await get()).toMatchObject({ scope: "A brand new AI scope.", scopeEditedAt: null });
    await patch({ scope: "Mine again" });
    reply("ignored");
    await post(estimate, { replaceEdited: "yes" }); // only a real true counts
    expect((await get())!.scope).toBe("Mine again");
  });
  it("gives the AI the owner's corrections, fenced as data, and says to follow them", async () => {
    await patch({ corrections: "A ticket waiting for the customer has the status pending." });
    reply();
    await post(estimate);
    expect(ai.prompts[0]).toMatch(/<owner-corrections-[0-9a-f]{12}>/);
    expect(ai.prompts[0]).toContain("status pending");
    expect(ai.prompts[0]).toContain("treat them as facts and follow them");
    ai.prompts = [];
    await patch({ corrections: "" });
    await post(estimate);
    expect(ai.prompts[0]).not.toContain("owner-corrections");
  });
});

describe("writing the build prompt again", () => {
  beforeEach(() => { ai.reply = "# Fresh AI brief"; });

  it("replaces a prompt the AI wrote, as before, with the owner's corrections and scope in what it is given", async () => {
    await patch({ corrections: "Use the existing email.ts", scope: "Fold it into the retention job." });
    expect((await post(plan)).status).toBe(200);
    expect(await get()).toMatchObject({ plan: "# Fresh AI brief", planEditedAt: null });
    expect(ai.prompts[0]).toContain("Use the existing email.ts");
    expect(ai.prompts[0]).toContain("written or changed by the owner: follow it");
    expect(ai.prompts[0]).toContain("Fold it into the retention job.");
  });
  it("refuses to replace a prompt the owner changed, unless told to, and then it is the AI's again", async () => {
    await patch({ plan: "# My brief" });
    const refused = await post(plan);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "edited" });
    expect((await get())!.plan).toBe("# My brief");
    expect(ai.prompts).toHaveLength(0); // no AI call was spent
    expect((await post(plan, { replaceEdited: true })).status).toBe(200);
    expect(await get()).toMatchObject({ plan: "# Fresh AI brief", planEditedAt: null });
  });
  it("an emptied prompt is just a missing one: planning is not refused", async () => {
    await patch({ plan: "# My brief" });
    await patch({ plan: "" });
    expect((await post(plan)).status).toBe(200);
  });
});

describe("the pieces", () => {
  it("builds the corrections block only when there is something to say, and marks an owner's scope", () => {
    expect(correctionsBlock(null)).toBe("");
    expect(correctionsBlock("   ")).toBe("");
    expect(correctionsBlock("It exists")).toContain("It exists");
    expect(scopeLine({ scope: null })).toBe("AI scope estimate: (not estimated)");
    expect(scopeLine({ scope: "x", scopeEditedAt: null })).toBe("AI scope estimate: x");
    expect(scopeLine({ scope: "x", scopeEditedAt: new Date() })).toContain("written or changed by the owner");
    const block = ideaBlock({ kind: "idea", title: "T", notes: "N", repro: null, severity: null, scope: "S", scopeEditedAt: new Date(), corrections: "C!", complexity: "S", impact: "low" }, "", "");
    expect(block).toContain("C!");
    expect(block).toContain("follow it, do not second-guess it");
  });
  it("the split into stories reads them too", () => {
    const src = read("src/app/api/ideas/[id]/breakdown/route.ts");
    expect(src).toMatch(/\$\{correctionsBlock\(idea\.corrections\)\}\$\{scopeLine\(idea\)\}/);
  });
});

describe("on the idea page", () => {
  const page = read("src/app/(app)/ideas/ideas-detail.tsx");
  it("has Edit buttons, a mark for the owner's own text, and a way to write a new one that asks first", () => {
    for (const needle of ["Edit the scope", "Edit the build prompt", "Written by you", "Changed by you", "Write a new scope", "Write a new one", "Re-size", 'data-testid="scope-edited"', 'data-testid="plan-edited"']) expect(page, needle).toContain(needle);
    expect(page).toContain('window.confirm("Write a new scope and lose the one you wrote?")');
    expect(page).toContain('window.confirm("You changed this build prompt by hand. Write a new one and lose your changes?")');
  });
  it("a refused replacement from anywhere (the journey card's Plan again included) goes through the same question, and saying no changes nothing", () => {
    expect(page).toMatch(/res\.status === 409 && d\?\.code === "edited"/);
    expect(page).toMatch(/return runPlan\(quiet, true\);\s*return ideaRef\.current;/);
  });
  it("has the What's wrong with this box on the scope and on the build prompt", () => {
    expect(page).toContain('id="corrections-scope"');
    expect(page).toContain('id="corrections-plan"');
    const box = read("src/app/(app)/ideas/owner-edit.tsx");
    expect(box).toContain("What&apos;s wrong with this?");
    expect(box).toContain("It follows this over its own guess");
  });
});
