import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children) }));

import { journeyFor, buildLabel, fixChecksRequest, closureNoteFor, JOURNEY_STAGES, type JourneyInput, type Rec } from "@/lib/runs/journey";
import { IdeaJourney } from "@/app/(app)/ideas/idea-journey";
import type { Idea } from "@/app/(app)/ideas/ideas-shared";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const HAIKU: Rec = { model: "claude-haiku-5-5", effort: "low", maxTurns: 30, index: 0 };
const OPUS: Rec = { model: "claude-opus-5-5", effort: "high", maxTurns: 80, index: 2 };
const base: JourneyInput = {
  idea: { title: "Add a footer", complexity: "S", plan: "A brief", status: "new" },
  run: null, epic: null,
  access: { aiBuild: true, needsPlan: false, capReached: null },
  recommended: HAIKU, reportsCost: true,
};
const view = (over: Partial<JourneyInput>) => journeyFor({ ...base, ...over });
const run = (status: string, over: Record<string, unknown> = {}) => ({ id: "r1", kind: "implement", status, checksState: null, prNumber: null, error: null, ...over });

describe("the journey: which stage and what the one button does", () => {
  it("has the five agreed stages, in order", () => {
    expect(JOURNEY_STAGES.map((s) => s.label)).toEqual(["Describe", "Plan", "Build", "Review", "Ship"]);
  });
  it("an idea with no size and no plan: Describe, button Plan it", () => {
    const v = view({ idea: { title: "x", complexity: null, plan: null, status: "new" } });
    expect(v).toMatchObject({ stage: "describe", primary: { action: "plan", label: "Plan it" } });
  });
  it("a sized idea with no plan: still Plan it", () => {
    expect(view({ idea: { ...base.idea, plan: null } })).toMatchObject({ stage: "describe", primary: { action: "plan" } });
  });
  it("a planned, sized idea: Plan stage, Build it with the cost when the model is the usual one for the size", () => {
    expect(view({})).toMatchObject({ stage: "plan", primary: { action: "build", label: "Build it, up to $0.05" } });
    expect(view({}).secondary.map((s) => s.action)).toEqual(["adjust", "replan"]);
  });
  it("does not promise a cost when a stronger model is about to be used, or when the provider reports none", () => {
    expect(view({ recommended: OPUS }).primary?.label).toBe("Build it");
    expect(view({ reportsCost: false }).primary?.label).toBe("Build it");
    expect(buildLabel("M", { ...HAIKU, index: 1 }, true)).toBe("Build it, up to $0.60");
    expect(buildLabel("L", { ...OPUS, index: 2 }, true)).toBe("Build it, up to $2.5");
    expect(buildLabel("XL", OPUS, true)).toBe("Build it");
    expect(buildLabel(null, HAIKU, true)).toBe("Build it");
  });
  it("a run waiting for approval: the button approves it", () => {
    expect(view({ run: run("awaiting_approval") })).toMatchObject({ stage: "plan", primary: { action: "approve", label: "Build it, up to $0.05" } });
  });
  it("running: Build stage, no primary button, Cancel run", () => {
    for (const status of ["dispatched", "running"]) {
      const v = view({ run: run(status) });
      expect(v.stage).toBe("build");
      expect(v.primary).toBeNull();
      expect(v.secondary).toEqual([{ action: "cancel", label: "Cancel run" }]);
    }
  });
  it("a failed run: Build stage, Try again with the cost", () => {
    expect(view({ run: run("failed", { error: "x" }) })).toMatchObject({ stage: "build", primary: { action: "retry", label: "Try again, up to $0.05" } });
  });
  it("review: Merge when green, fix it when red, wait while checks run", () => {
    expect(view({ run: run("pr_open", { checksState: "green" }) })).toMatchObject({ stage: "review", primary: { action: "merge", label: "Merge" } });
    expect(view({ run: run("pr_open", { checksState: "red" }) })).toMatchObject({ stage: "review", primary: { action: "fix", label: "Ask the AI to fix it" } });
    const pending = view({ run: run("pr_open", { checksState: "pending" }) });
    expect(pending).toMatchObject({ stage: "review", primary: null });
    for (const c of ["green", "red", "pending"]) expect(view({ run: run("pr_open", { checksState: c }) }).secondary.map((s) => s.action)).toEqual(["changes", "closePr"]);
  });
  it("merged or done: Ship, back to your ideas", () => {
    expect(view({ run: run("merged") })).toMatchObject({ stage: "ship", primary: { action: "home" } });
    expect(view({ idea: { ...base.idea, status: "done" } })).toMatchObject({ stage: "ship" });
  });
  it("a closed or cancelled run goes back to Plan and says so", () => {
    for (const status of ["closed", "cancelled"]) expect(view({ run: run(status) })).toMatchObject({ stage: "plan", primary: { action: "build" }, headline: expect.stringMatching(/closed/) });
  });
  it("an Epic recommends a split and still allows building it as one", () => {
    const planned = view({ idea: { ...base.idea, complexity: "XL" } });
    expect(planned).toMatchObject({ stage: "plan", primary: { action: "split", label: "Split it into steps" } });
    expect(planned.secondary).toEqual([{ action: "buildAsOne", label: "Build it as one anyway" }]);
    expect(view({ idea: { ...base.idea, complexity: "XL", plan: null } })).toMatchObject({ stage: "describe", primary: { action: "split" } });
  });
  it("an idea already split goes step by step", () => {
    const epic = { children: [{ id: "a", status: "done" }, { id: "b", status: "new" }, { id: "c", status: "new" }], nextId: "b" };
    const v = view({ epic });
    expect(v).toMatchObject({ stage: "plan", primary: { action: "nextStep", label: "Open the next step" } });
    expect(v.headline).toMatch(/3 steps \(2 to go\)/);
    expect(view({ epic: { ...epic, nextId: null } }).primary).toBeNull();
  });
  it("says why the AI build buttons are missing, and keeps planning available", () => {
    expect(view({ access: { aiBuild: false, needsPlan: false, capReached: null } })).toMatchObject({ primary: null, blocked: expect.stringMatching(/switched off/) });
    expect(view({ access: { aiBuild: true, needsPlan: true, capReached: null } })).toMatchObject({ primary: null, blocked: expect.stringMatching(/Pro or a runs pack/) });
    expect(view({ access: { aiBuild: true, needsPlan: false, capReached: "Monthly cap reached." } })).toMatchObject({ primary: null, blocked: "Monthly cap reached." });
    expect(view({ idea: { title: "x", complexity: null, plan: null, status: "new" }, access: { aiBuild: false, needsPlan: true, capReached: "cap" } }).primary).toMatchObject({ action: "plan" });
  });
  it("an idea waiting on others cannot be built, says which, and can still be planned", () => {
    const v = view({ blockedBy: ["Add accounts"] });
    expect(v).toMatchObject({ stage: "plan", primary: null, blocked: 'Blocked by "Add accounts". Finish it first.' });
    expect(v.secondary.map((s) => s.action)).toEqual(["replan"]); // no point adjusting a run that cannot start
    expect(view({ blockedBy: ["A", "B"] }).blocked).toBe('Blocked by "A", "B". Finish them first.');
    expect(view({ blockedBy: ["A", "B", "C", "D", "E"] }).blocked).toBe('Blocked by "A", "B", "C" and 2 more. Finish them first.');
    expect(view({ blockedBy: [], idea: { ...base.idea, plan: null } })).toMatchObject({ primary: { action: "plan" } });
    expect(view({ blockedBy: ["A"], idea: { ...base.idea, plan: null } })).toMatchObject({ primary: { action: "plan" }, blocked: null });
    expect(view({ blockedBy: ["A"], run: run("awaiting_approval") }).primary).toBeNull();
    expect(view({ blockedBy: ["A"], access: { aiBuild: false, needsPlan: false, capReached: null } }).blocked).toMatch(/switched off/); // access comes first
  });
  it("the practice idea counts as sized", () => {
    expect(view({ idea: { title: "Practice: add a one-line note to the README", complexity: null, plan: "x", status: "new" } })).toMatchObject({ stage: "plan", primary: { action: "build" } });
  });
});

describe("the text the journey writes", () => {
  it("says what to expect before approving", () => {
    expect(read("src/lib/runs/journey.ts")).not.toContain("buildExpectation"); // the model, effort and turns are under Adjust, not on the card
  });
  it("pre-fills the fix request with the failing checks", () => {
    expect(fixChecksRequest(["build", "tests / unit"])).toBe("The checks failed: build, tests / unit. Find out why they fail, fix it with the smallest change, and make sure they pass.");
    expect(fixChecksRequest([])).toBe("The checks failed. Find out why they fail, fix it with the smallest change, and make sure they pass.");
    const many = fixChecksRequest(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(many).toContain("a, b, c, d, e, f.");
    expect(many).not.toContain(", g");
  });
  it("drafts a closing note from what the AI said, or falls back to the plain line", () => {
    const note = "## Summary\n\nI added the app version to the footer, read from the build, and a test that checks it.\n\n- Changed src/components/footer.tsx\n- Tests pass";
    expect(closureNoteFor(note, 12, "r1")).toBe("I added the app version to the footer, read from the build, and a test that checks it. Changed src/components/footer.tsx Tests pass. Shipped in PR #12.");
    expect(closureNoteFor(null, 12, "r1")).toBe("Shipped by Idea HQ in PR #12 (run r1).");
    expect(closureNoteFor("ok", 12, "r1")).toBe("Shipped by Idea HQ in PR #12 (run r1).");
    const long = closureNoteFor("x".repeat(40) + " " + "word ".repeat(200), 3, "r");
    expect(long.length).toBeLessThan(380);
    expect(long).toMatch(/Shipped in PR #3\.$/);
  });
  it("is written when a run is merged", () => {
    expect(read("src/lib/runs/engine.ts")).toContain("closureNote: closureNoteFor(");
  });
});

describe("the journey card", () => {
  const idea = { id: "i1", projectId: "p1", parentId: null, title: "Add a footer", notes: null, status: "new", priority: "none", tags: [], blockedBy: [], complexity: null, impact: null, scope: null, aiEstimatedAt: null, plan: null, plannedAt: null, closureNote: null, closedAt: null, kind: "idea", severity: null, repro: null, createdAt: "2026-10-22" } as Idea;
  const html = renderToStaticMarkup(createElement(IdeaJourney, { idea, onEstimate: async () => idea, onPlan: async () => idea, onSplit() {}, onReveal() {}, onSetSize() {}, onSaveClosure() {} }));
  it("shows the five stages with the current one marked, and a phone line", () => {
    for (const l of ["Describe", "Plan", "Build", "Review", "Ship"]) expect(html).toContain(l);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Step 1 of 5: Describe");
    expect(html).toContain('aria-label="Where this idea is"');
  });
  it("offers Plan it for a new idea", () => {
    expect(html).toMatch(/<button[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?Plan it<\/button>/);
  });
  it("is the main thing on the idea page: priority and value sit in the top card, the older cards are folded into Details", () => {
    const page = read("src/app/(app)/ideas/ideas-detail.tsx");
    const at = (s: string) => page.indexOf(s);
    expect(at("<IdeaJourney")).toBeGreaterThan(0);
    // top card first: priority and value are editable there
    expect(at('id="idea-priority"')).toBeGreaterThan(0);
    expect(at('id="idea-value"')).toBeGreaterThan(0);
    expect(at('id="idea-value"')).toBeLessThan(at("<IdeaJourney"));
    // then the journey, then one folded row holding everything else
    expect(at('aria-controls="idea-details"')).toBeGreaterThan(at("<IdeaJourney"));
    expect(page).toMatch(/aria-expanded=\{detailsOpen\}/);
    expect(page).toContain('hidden={!detailsOpen}'); // folded, not unmounted: stories and runs keep their state
    for (const s of ['id="idea-status"', "Dependencies", "<StoriesSection", "Implementation scope", "AI build prompt", "<RunPanel ", "Delete idea"]) {
      expect(at(s), s).toBeGreaterThan(at('aria-controls="idea-details"'));
    }
  });
  it("no longer has the Triage card or a second closing-note box; nothing else was lost", () => {
    const page = read("src/app/(app)/ideas/ideas-detail.tsx");
    expect(page).not.toMatch(/>\s*Triage\s*</);
    expect(page).not.toContain("{/* Closure note */}");
    expect(page).not.toContain("closureDraft");
    expect(page).toContain("onSaveClosure={(text) => patch({ closureNote: text || null })}");
    expect(page).toContain("onSetSize={(value) => patch({ complexity: value })}");
  });
  it("opens the folded details by itself for an Epic, and when the journey sends people into them", () => {
    const page = read("src/app/(app)/ideas/ideas-detail.tsx");
    expect(page).toMatch(/useState\(\(\) => childStories\.length > 0 \|\| initial\.complexity === "XL"\)/);
    expect(page).toMatch(/const reveal = \(id: string\) => \{\s*setDetailsOpen\(true\)/);
    expect(page).toContain("onReveal={reveal}");
    const journey = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(journey).toContain('onReveal("implement-with-ai")');
    expect(journey).not.toContain("scrollIntoView");
  });
  it("the run panel keeps only what the journey does not do, and still merges and follows a revert", () => {
    const panel = read("src/app/(app)/ideas/run-panel.tsx");
    // gone: starting, sizing notices, progress and review of an implementation (the journey card does those)
    for (const gone of ["Implement again", "Request changes", "Approve and merge", "Size this idea first", "needsSize", "compact"]) expect(panel, gone).not.toContain(gone);
    // kept: approval with a changed model or turn limit, the AI's note, revert
    for (const kept of ["Change model and effort", "Approve and run", "What the AI said", "Revert this change"]) expect(panel, kept).toContain(kept);
    // a revert is not an idea's run, so the journey ignores it: the panel merges it and follows its progress
    expect(panel).toContain('run.kind === "revert" && run.status === "pr_open"');
    expect(panel).toContain('run.kind === "revert" && BUSY.includes(run.status) && <RunProgress');
    expect(panel).toContain("Merge the revert");
  });
  it("the welcome pages use the same journey card for the first AI change, and no longer carry their own run panel", () => {
    const welcome = read("src/app/welcome/welcome.tsx");
    expect(welcome).toContain("<IdeaJourney");
    expect(welcome).toContain("allowAdjust={false}");
    expect(welcome).not.toContain("<RunPanel");
    expect(welcome).not.toContain("Generate the build prompt");
    expect(welcome).toContain("window.addEventListener(RUNS_CHANGED, load)");
    // the steps before it are untouched
    for (const s of ["Create your first project", "This looks right", "Do you already have a list of ideas?", "Your first AI change"]) expect(welcome, s).toContain(s);
  });
  it("the onboarding payload carries what the card needs", () => {
    const o = read("src/lib/onboarding.ts");
    expect(o).toContain("scope: string | null; status: string; closureNote: string | null; closedAt: string | null;");
    expect(o).toContain("closedAt: i.closedAt ? i.closedAt.toISOString() : null");
  });
  it("the card can leave out Adjust model and turns", () => {
    const journey = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(journey).toContain("allowAdjust || s.action !== \"adjust\"");
    expect(journey).toContain("allowAdjust = true");
  });
  it("looks again at what a new run would use when the size changes", () => {
    expect(read("src/app/(app)/ideas/idea-journey.tsx")).toContain("useEffect(() => { void load(); }, [load, idea.complexity]);");
  });
  it("lets the person set the size by hand in the journey card", () => {
    const html = renderToStaticMarkup(createElement(IdeaJourney, { idea, onEstimate: async () => idea, onPlan: async () => idea, onSplit() {}, onReveal() {}, onSetSize() {}, onSaveClosure() {} }));
    expect(html).toContain('id="journey-size"');
    expect(html).toContain("Not sized yet");
    for (const label of ["Quick: 4 to 8 minutes", "Standard: 6 to 15 minutes", "Large: 12 to 30 minutes", "Epic: split it first"]) expect(html).toContain(label);
  });
  it("the stories section and run panel listen for it", () => {
    expect(read("src/app/(app)/ideas/ideas-stories.tsx")).toContain("startSignal");
    expect(read("src/app/(app)/ideas/ideas-stories.tsx")).toContain('<Card id="stories">');
    const panel = read("src/app/(app)/ideas/run-panel.tsx");
    expect(panel).toContain("RUNS_CHANGED");
    expect(panel).toContain("announceRunsChanged()");
    expect(panel).toContain('<Card id="implement-with-ai">');
  });
  it("the runs route also returns what a new run would use and which checks failed", () => {
    const route = read("src/app/api/ideas/[id]/runs/route.ts");
    expect(route).toContain("failingChecks");
    expect(route).toContain('id: "preview"');
  });
  it("no click event leaks into the quiet flag of the estimate and plan calls", () => {
    const page = read("src/app/(app)/ideas/ideas-detail.tsx");
    expect(page).not.toMatch(/onClick=\{runEstimate\}|onClick=\{runPlan\}/);
  });
});

describe("the card before its builds have loaded", () => {
  const planned = { id: "i1", title: "Add a footer", complexity: "S", plan: "A brief", scope: "x", status: "new", closureNote: null, closedAt: null } as unknown as Parameters<typeof IdeaJourney>[0]["idea"];
  const html = renderToStaticMarkup(createElement(IdeaJourney, { idea: planned, onEstimate: async () => planned, onPlan: async () => planned, onSplit() {}, onReveal() {}, onSetSize() {}, onSaveClosure() {} }));

  it("says it is checking, switches Build off until it knows, and has no stray sentence", () => {
    expect(html).toContain("Checking what a build would use");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Build it/);
    expect(html).not.toContain(". That limit is a safety ceiling");
    expect(html).not.toMatch(/>\s*\./);
  });
  it("the failed-load message and its retry exist, and a poll does not re-ask for the history", () => {
    const src = read("src/app/(app)/ideas/idea-journey.tsx");
    expect(src).toContain("Could not load this idea&apos;s builds");
    expect(src).toMatch(/Try again<\/Button>/);
    expect(src).toMatch(/\?poll=1/);
    expect(src).toMatch(/history: json\.history \?\? prev\?\.history/);
  });
});
