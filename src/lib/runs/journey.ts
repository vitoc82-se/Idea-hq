import { effectiveSize, type Size } from "./size";
import { SIZE_PROFILE } from "./sizes";
import { stepsWord, withoutStepsBlock } from "./owner-steps";

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
  | "finish" // merged, but setup steps only the owner can do are still open
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
  // Titles of the ideas that must ship first and are not done. While there are any, the AI does not build this one.
  blockedBy?: string[];
  // Setup steps only the owner can do (a new environment variable, a setting): how many are not ticked yet, and how many
  // of those should be done before the merge so that the deploy works.
  stepsOpen?: number;
  stepsOpenBefore?: number;
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
  const lines = withoutStepsBlock(agentNote)
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

// Adjusting a run only makes sense when one could start; planning again always does.
function buildSecondary(blocked: string | null): JourneyView["secondary"] {
  return blocked ? [{ action: "replan", label: "Plan again" }] : [{ action: "adjust", label: "Adjust model and turns" }, { action: "replan", label: "Plan again" }];
}

export function journeyFor(i: JourneyInput): JourneyView {
  const size = effectiveSize(i.idea);
  const { run, epic } = i;
  const base = { secondary: [] as JourneyView["secondary"], blocked: null as string | null };

  // What stops the AI build buttons (not planning, which uses the helper AI).
  const blocked = !i.access.aiBuild ? "AI build is switched off for your account. Ask the owner." : i.access.needsPlan ? "AI build needs Pro or a runs pack. Open Billing." : i.access.capReached;
  const waiting = i.blockedBy ?? [];
  const names = waiting.slice(0, 3).map((t) => `"${t}"`).join(", ") + (waiting.length > 3 ? ` and ${waiting.length - 3} more` : "");
  const buildBlocked = blocked ?? (waiting.length ? `Blocked by ${names}. Finish ${waiting.length === 1 ? "it" : "them"} first.` : null);

  // Ship: merged, or the idea is done.
  if (i.idea.status === "done" || run?.status === "merged") {
    const left = i.stepsOpen ?? 0;
    if (left > 0) {
      return { ...base, stage: "ship", headline: `Merged, but it will not work until you finish ${left === 1 ? "1 setup step" : `${left} setup steps`}.`, primary: { action: "finish", label: left === 1 ? "Do the setup step" : "Do the setup steps" } };
    }
    return { ...base, stage: "ship", headline: "Merged. The idea is done.", primary: { action: "home", label: "Back to your ideas" } };
  }

  // Review: a pull request is open.
  if (run?.status === "pr_open") {
    const sec: JourneyView["secondary"] = [{ action: "changes", label: "Ask for changes" }, { action: "closePr", label: "Close PR" }];
    if (run.checksState === "red") {
      return { stage: "review", headline: "The checks failed. The AI can try to fix it.", primary: buildBlocked ? null : { action: "fix", label: "Ask the AI to fix it" }, secondary: sec, blocked: buildBlocked };
    }
    if (run.checksState === "green") {
      const before = i.stepsOpenBefore ?? 0;
      const headline = before > 0
        ? `Build and tests passed. Do ${before === 1 ? "1 setup step" : `${before} setup steps`} first (below), then merge.`
        : "Build and tests passed. Read the change, then merge it.";
      return { stage: "review", headline, primary: { action: "merge", label: "Merge" }, secondary: sec, blocked: null };
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
    return { stage: "plan", headline: "Ready to build. Press the button to approve the run.", primary: buildBlocked ? null : { action: "approve", label: buildLabel(size, i.recommended, i.reportsCost) }, secondary: buildSecondary(buildBlocked), blocked: buildBlocked };
  }
  return {
    stage: "plan",
    headline: run?.status === "closed" || run?.status === "cancelled" ? "The last run was closed. You can build it again." : "Planned. Ready to build.",
    primary: buildBlocked ? null : { action: "build", label: buildLabel(size, i.recommended, i.reportsCost) },
    secondary: buildSecondary(buildBlocked),
    blocked: buildBlocked,
  };
}


// One line per idea on the board: which of the five stages it is in and what happens next. The same rules as the card
// on the idea page (journeyFor), with the things the board does not load (the model, the plan limits) left out.
export type BoardNext = {
  stage: JourneyStage | null; // null: parked, not on the journey
  stageLabel: string;
  number: number; // 1 to 5, 0 when parked
  next: string; // what comes next, in the card's own words
  action: PrimaryAction | null; // the button the idea page would show; null while the AI or the checks are working
};

export type BoardInput = {
  idea: { title?: string | null; complexity?: string | null; plan?: string | null; status: string };
  run: { id?: string; status: string; kind?: string; checksState?: string | null } | null;
  epic: { children: { id: string; status: string }[]; nextId: string | null } | null;
  blockedBy?: string[];
  stepsOpen?: number; // setup steps the owner has not ticked yet
};

export function boardNext(i: BoardInput): BoardNext {
  if (i.idea.status === "parked") return { stage: null, stageLabel: "Parked", number: 0, next: "Not planned for now", action: null };
  const view = journeyFor({
    idea: i.idea,
    run: i.run ? { id: i.run.id ?? "", kind: i.run.kind ?? "implement", ...i.run } : null,
    epic: i.epic,
    access: { aiBuild: true, needsPlan: false, capReached: null },
    recommended: null, reportsCost: false, blockedBy: i.blockedBy, stepsOpen: i.stepsOpen,
  });
  const idx = JOURNEY_STAGES.findIndex((s) => s.id === view.stage);
  const base = { stage: view.stage, stageLabel: JOURNEY_STAGES[idx].label, number: idx + 1 };
  const labels: Partial<Record<PrimaryAction, string>> = { home: "Done" };
  if (view.stage === "ship" && view.primary?.action === "finish") return { ...base, next: `Finish ${stepsWord(i.stepsOpen ?? 0)}`, action: "finish" };
  if (view.stage === "ship") return { ...base, next: "Done: merged", action: null };
  // The AI cannot build it yet: say what it waits for, the way the card does.
  if (view.blocked && /^Blocked by/.test(view.blocked)) return { ...base, next: view.blocked, action: null };
  if (view.primary) return { ...base, next: labels[view.primary.action] ?? view.primary.label, action: view.primary.action };
  if (view.stage === "build") return { ...base, next: "The AI is working on it", action: null };
  if (view.stage === "review") return { ...base, next: "Your project's checks are running", action: null };
  return { ...base, next: "Waiting for the other steps", action: null };
}

// An idea the AI can plan right now: sized and planned is what Build needs, and Plan it does both.
export function wantsPlan(i: BoardInput): boolean {
  return i.idea.status !== "parked" && boardNext({ ...i, blockedBy: [] }).action === "plan";
}

// "Needs you": the ideas where the next move is the owner's. The AI has finished or stopped, or it is waiting for a
// go-ahead. An idea the AI or the checks are working on, one waiting on another idea, a parked one and a finished one
// need nothing. Planning is left out: it is the one step Plan them all does in bulk. The order is the urgency: finished
// work waiting to be merged first, a build ready to start last.
const NEEDS_YOU_ORDER: PrimaryAction[] = ["merge", "finish", "fix", "retry", "approve", "build", "split"];

export function needsYou(n: Pick<BoardNext, "action">): boolean {
  return n.action !== null && NEEDS_YOU_ORDER.includes(n.action);
}

// Smaller is more urgent; ideas that do not need the owner sort after every one that does.
export function needsYouRank(n: Pick<BoardNext, "action">): number {
  const i = n.action ? NEEDS_YOU_ORDER.indexOf(n.action) : -1;
  return i < 0 ? NEEDS_YOU_ORDER.length : i;
}
