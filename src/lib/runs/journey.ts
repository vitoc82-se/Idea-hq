import { effectiveSize, type Size } from "./size";
import { SIZE_NAMES, SIZE_PROFILE, sizeExpectation } from "./sizes";

// The idea page as one journey: Describe, Plan, Build, Review, Ship. This file decides, from what the idea and its
// latest run look like, which stage it is in and what the one primary button does. It is plain data in and out so it
// can be tested without a screen; the card (app/(app)/ideas/idea-journey.tsx) only draws it and performs the action.
export const JOURNEY_STAGES = [
  { id: "describe", label: "Describe" },
  { id: "plan", label: "Plan" },
  { id: "build", label: "Build" },
  { id: "review", label: "Review" },
  { id: "ship", label: "Ship" },
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number]["id"];

export type PrimaryAction =
  | "plan" // size it if needed, then write the brief
  | "build" // start a run and approve it: this click is the approval of cost, time and model
  | "approve" // a run is already waiting for approval
  | "split" // an Epic: split it into steps
  | "nextStep" // an idea split into steps: go to the next one
  | "merge"
  | "fix" // checks failed: ask the AI to fix them
  | "retry" // the run failed: try again
  | "home"; // all done

export type SecondaryAction = "buildAsOne" | "adjust" | "cancel" | "changes" | "closePr" | "replan";

export type Rec = { model: string; effort: string; maxTurns: number; index: number };

export type JourneyInput = {
  idea: { title?: string | null; complexity?: string | null; plan?: string | null; status: string };
  run: { id: string; status: string; kind: string; checksState?: string | null; prNumber?: number | null; error?: string | null } | null;
  epic: { children: { id: string; status: string }[]; nextId: string | null } | null;
  access: { aiBuild: boolean; needsPlan: boolean; capReached: string | null };
  recommended: Rec | null;
  reportsCost: boolean;
};

export type JourneyView = {
  stage: JourneyStage;
  headline: string;
  primary: { action: PrimaryAction; label: string } | null;
  secondary: { action: SecondaryAction; label: string }[];
  // Why the AI build buttons are not offered (switched off, no plan, monthly cap), in a plain sentence.
  blocked: string | null;
};

const money = (n: number) => `$${n < 1 ? n.toFixed(2) : String(Math.round(n * 10) / 10)}`;

const SIZE_INDEX: Record<Size, number> = { S: 0, M: 1, L: 2, XL: 3 };

// "Build it, up to $0.05". The cost is only promised when the model about to be used is the one that size normally
// gets; a stronger setting (a project set to maximum quality, a retry) costs more, so then the button just says Build it.
export function buildLabel(size: Size | null, rec: Rec | null, reportsCost: boolean): string {
  if (size && size !== "XL" && rec && reportsCost && rec.index === SIZE_INDEX[size]) return `Build it, up to ${money(SIZE_PROFILE[size].usd[1])}`;
  return "Build it";
}

// "claude-haiku-5-5" is shown as "Haiku 5.5".
function modelName(id: string): string {
  const m = /^(?:claude-)?([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

// What the idea's "what to expect" line says before approving: the size, the model, the turn limit.
export function buildExpectation(size: Size | null, rec: Rec | null, reportsCost: boolean): string {
  const parts: string[] = [];
  if (size) parts.push(`${SIZE_NAMES[size]}: ${sizeExpectation(size, { withCost: reportsCost })}`);
  if (rec) parts.push(`It will use ${modelName(rec.model)} at ${rec.effort} effort, with a limit of ${rec.maxTurns} turns`);
  return parts.join(". ");
}

// The request box that arrives pre-filled when the checks fail.
export function fixChecksRequest(failing: string[]): string {
  const names = failing.filter(Boolean).slice(0, 6);
  return names.length
    ? `The checks failed: ${names.join(", ")}. Find out why they fail, fix it with the smallest change, and make sure they pass.`
    : "The checks failed. Find out why they fail, fix it with the smallest change, and make sure they pass.";
}

// A closing note for a merged idea, drafted from what the AI said at the end of its run. Without that it falls back
// to the plain line that was always written.
export function closureNoteFor(agentNote: string | null | undefined, prNumber: number | null | undefined, runId: string): string {
  const fallback = `Shipped by Idea HQ in PR #${prNumber} (run ${runId}).`;
  if (!agentNote) return fallback;
  const lines = agentNote
    .split("\n")
    .map((l) => l.replace(/^[\s>#*\-•\d.)]+/, "").replace(/[*_`]/g, "").trim())
    .filter((l) => l && !/^(summary|what i (did|changed)|changes?|tests?|testing)\s*:?$/i.test(l));
  let text = "";
  for (const l of lines) {
    if (text.length >= 140) break;
    text += (text ? " " : "") + l;
    if (text.length > 320) break;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 320) text = text.slice(0, 320).replace(/\s+\S*$/, "") + "…";
  if (text.length < 12) return fallback;
  return `${/[.!?…]$/.test(text) ? text : `${text}.`} Shipped in PR #${prNumber}.`;
}

export function journeyFor(i: JourneyInput): JourneyView {
  const size = effectiveSize(i.idea);
  const { run, epic } = i;
  const base = { secondary: [] as JourneyView["secondary"], blocked: null as string | null };

  // What stops the AI build buttons (not planning, which uses the helper AI).
  const blocked = !i.access.aiBuild ? "AI build is switched off for your account. Ask the owner." : i.access.needsPlan ? "AI build needs Pro or a runs pack. Open Billing." : i.access.capReached;
  const buildBlocked = blocked ?? null;

  // Ship: merged, or the idea is done.
  if (i.idea.status === "done" || run?.status === "merged") {
    return { ...base, stage: "ship", headline: "Merged. The idea is done.", primary: { action: "home", label: "Back to your ideas" } };
  }

  // Review: a pull request is open.
  if (run?.status === "pr_open") {
    const sec: JourneyView["secondary"] = [{ action: "changes", label: "Ask for changes" }, { action: "closePr", label: "Close PR" }];
    if (run.checksState === "red") {
      return { stage: "review", headline: "The checks failed. The AI can try to fix it.", primary: buildBlocked ? null : { action: "fix", label: "Ask the AI to fix it" }, secondary: sec, blocked: buildBlocked };
    }
    if (run.checksState === "green") {
      return { stage: "review", headline: "Build and tests passed. Read the change, then merge it.", primary: { action: "merge", label: "Merge" }, secondary: sec, blocked: null };
    }
    return { stage: "review", headline: "Your project's checks are running.", primary: null, secondary: sec, blocked: null };
  }

  // Build: the AI is working, or it failed.
  if (run?.status === "dispatched" || run?.status === "running") {
    return { ...base, stage: "build", headline: "The AI is working on it.", primary: null, secondary: [{ action: "cancel", label: "Cancel run" }] };
  }
  if (run?.status === "failed") {
    return { stage: "build", headline: "That run did not finish.", primary: buildBlocked ? null : { action: "retry", label: buildLabel(size, i.recommended, i.reportsCost).replace("Build it", "Try again") }, secondary: [], blocked: buildBlocked };
  }

  // An idea already split into steps goes step by step.
  if (epic && epic.children.length > 0) {
    const left = epic.children.filter((c) => c.status !== "done").length;
    if (epic.nextId) return { ...base, stage: "plan", headline: `This idea is split into ${epic.children.length} steps (${left} to go). Build them one at a time, in order.`, primary: { action: "nextStep", label: "Open the next step" } };
    return { ...base, stage: "plan", headline: "Every step is done or waiting on another.", primary: null };
  }

  const hasPlan = !!i.idea.plan;

  // Describe: nothing planned yet.
  if (!hasPlan || !size) {
    // An Epic that has been sized but not split: propose the split before any plan is written.
    if (size === "XL") {
      return { stage: "describe", headline: "This is an Epic: more than one run can do safely. Split it into steps first.", primary: { action: "split", label: "Split it into steps" }, secondary: [{ action: "buildAsOne", label: "Build it as one anyway" }], blocked: null };
    }
    return { ...base, stage: "describe", headline: size ? "Ready for a plan." : "Describe it, then let the AI size it and write the plan.", primary: { action: "plan", label: "Plan it" }, secondary: [] };
  }

  // Plan: planned and sized. An Epic still recommends a split.
  if (size === "XL") {
    return { stage: "plan", headline: "This is an Epic: more than one run can do safely. Splitting it into steps is cheaper and fails less.", primary: { action: "split", label: "Split it into steps" }, secondary: [{ action: "buildAsOne", label: "Build it as one anyway" }], blocked: buildBlocked };
  }
  if (run?.status === "awaiting_approval") {
    return { stage: "plan", headline: "Ready to build. Press the button to approve the run.", primary: buildBlocked ? null : { action: "approve", label: buildLabel(size, i.recommended, i.reportsCost) }, secondary: [{ action: "adjust", label: "Adjust model and turns" }, { action: "replan", label: "Plan again" }], blocked: buildBlocked };
  }
  return {
    stage: "plan",
    headline: run?.status === "closed" || run?.status === "cancelled" ? "The last run was closed. You can build it again." : "Planned. Ready to build.",
    primary: buildBlocked ? null : { action: "build", label: buildLabel(size, i.recommended, i.reportsCost) },
    secondary: [{ action: "adjust", label: "Adjust model and turns" }, { action: "replan", label: "Plan again" }],
    blocked: buildBlocked,
  };
}

