// Which model and effort the AI uses, picked automatically from how big the idea
// is, and always overridable by the user. Principle: the cheapest setup that is
// still safe. "Safe" comes from the gates around the AI (build + tests must pass
// before merge, a human reads the diff, a one-click step up if a cheap run
// fails), not from the model alone.
//
// The per-vendor facts (models, tiers, efforts) live in src/lib/providers. The
// exports below keep their original names and, called without a provider, behave
// exactly as before (Claude): frozen by tests/golden-claude.test.ts.

import { claude, getProvider } from "../providers";
import type { Effort, ModelChoice, ProviderId, Tier } from "../providers";

export type { Effort, ModelChoice, Tier };
export type Complexity = "S" | "M" | "L" | "XL";
export type Bias = "saver" | "auto" | "max";

export const MODELS: ModelChoice[] = claude.models;
export const MODEL_IDS = MODELS.map((m) => m.id);
export const EFFORTS: Effort[] = claude.efforts;
export const MAX_TURNS_RANGE = { min: 5, max: 100 };

// Ordered cheap to strong. Index 0..3 matches S, M, L, XL.
export const TIERS: Tier[] = claude.tiers;

const BASE_INDEX: Record<Complexity, number> = { S: 0, M: 1, L: 2, XL: 3 };

export function isComplexity(c: unknown): c is Complexity {
  return c === "S" || c === "M" || c === "L" || c === "XL";
}

export type Recommendation = Tier & { index: number; reason: string };

// `failedAttempts`: earlier runs of this idea that failed or made no change. Each
// one steps up a tier, so a cheap model that could not do it hands over to a
// stronger one without the user having to think about it.
export function recommendTier(
  complexity: string | null | undefined,
  bias: string | null | undefined = "auto",
  failedAttempts = 0,
  provider: ProviderId | string | null | undefined = "claude"
): Recommendation {
  const tiers = getProvider(provider).tiers;
  const known = isComplexity(complexity);
  const base = known ? BASE_INDEX[complexity] : 1; // unknown size: middle of the road
  const shift = bias === "saver" ? -1 : bias === "max" ? 1 : 0;
  const step = Math.max(0, Math.min(3, failedAttempts));
  const index = Math.max(0, Math.min(tiers.length - 1, base + shift + step));
  const parts = [known ? `${complexity} sized idea` : "size not estimated yet"];
  if (shift) parts.push(shift < 0 ? "project set to save money" : "project set to maximum quality");
  if (step) parts.push(`stepping up after ${step} failed attempt${step > 1 ? "s" : ""}`);
  return { ...tiers[index], index, reason: parts.join(", ") };
}

// A run that used every turn it was given did not break, it ran out. (Claude Code counts the closing turn too, so
// "used as many as allowed or more".) Only meaningful for a run that failed.
export function ranOutOfTurns(run: { turns?: number | null; maxTurns?: number | null }): boolean {
  return typeof run.turns === "number" && typeof run.maxTurns === "number" && run.maxTurns > 0 && run.turns >= run.maxTurns;
}

// A failed run is a reason to try a stronger model only when the AI itself came up short: it finished and changed
// nothing. A broken install, a missing key, no credit, a GitHub or permission problem say nothing about the model,
// and a bug it could not reproduce is a matter of the report (clearer steps help, a bigger model does not), so none
// of those move it up (a stronger model costs several times more).
export function suggestsStrongerModel(run: { error?: string | null }): boolean {
  return /made no changes/i.test(run.error ?? "");
}

// What the next try gets after a run ran out: about 70% more, up to the most a run may have.
export function moreTurns(maxTurns: number): number {
  return Math.min(MAX_TURNS_RANGE.max, Math.ceil(maxTurns * 1.7));
}

export type Override = { model?: unknown; effort?: unknown; maxTurns?: unknown };

// Validate user choices against the allow-lists; anything missing or invalid
// falls back to the recommendation. Returns the tier to run plus whether the
// user changed anything.
export function resolveTier(
  rec: Recommendation,
  o: Override = {},
  provider: ProviderId | string | null | undefined = "claude"
): { tier: Tier; overridden: boolean } {
  const p = getProvider(provider);
  const modelIds = p.models.map((m) => m.id);
  const model = typeof o.model === "string" && modelIds.includes(o.model) ? o.model : rec.model;
  const effort = typeof o.effort === "string" && (p.efforts as string[]).includes(o.effort) ? (o.effort as Effort) : rec.effort;
  const n = Number(o.maxTurns);
  const maxTurns =
    Number.isFinite(n) && n >= MAX_TURNS_RANGE.min && n <= MAX_TURNS_RANGE.max ? Math.round(n) : rec.maxTurns;
  return {
    tier: { model, effort, maxTurns },
    overridden: model !== rec.model || effort !== rec.effort || maxTurns !== rec.maxTurns,
  };
}

// The time limit for a run: by the strongest tier whose model was chosen, so a
// user who picks a big model is not cut off by a cheap tier's short timeout.
export function timeoutFor(provider: ProviderId | string | null | undefined, model: string, fallbackIndex: number): number {
  const p = getProvider(provider);
  const i = p.tiers.findIndex((t) => t.model === model);
  return p.timeoutMinutes(i >= 0 ? Math.max(i, 0) : fallbackIndex);
}

export const modelLabel = (id: string | null | undefined) => {
  for (const pid of ["claude", "openai"] as const) {
    const m = getProvider(pid).models.find((x) => x.id === id);
    if (m) return m.label;
  }
  return id ?? "default";
};

// Models for the quick planning calls Idea HQ makes itself (server key, so
// cost matters to the owner). These stay on Claude whatever provider a project
// runs its implementer on (review: helper calls are not part of this change).
export const PLANNING_MODEL = {
  estimate: "claude-sonnet-5-5",
  context: "claude-sonnet-5-5",
  breakdown: "claude-opus-5-5",
} as const;

export function planModel(complexity: string | null | undefined): string {
  return complexity === "L" || complexity === "XL" ? "claude-opus-5-5" : "claude-sonnet-5-5";
}

// Learning a project means reading a whole repo and writing it up, so it gets a
// stronger setup than a small change, but a bounded one.
export const LEARN_TIER: Tier = claude.learnTier;
