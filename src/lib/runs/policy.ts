// Which model and effort the AI uses, picked automatically from how big the idea
// is, and always overridable by the user. Principle: the cheapest setup that is
// still safe. "Safe" comes from the gates around the AI (build + tests must pass
// before merge, a human reads the diff, a one-click step up if a cheap run
// fails), not from the model alone.

export type Complexity = "S" | "M" | "L" | "XL";
export type Effort = "low" | "medium" | "high" | "max";
export type Bias = "saver" | "auto" | "max";

export type ModelChoice = { id: string; label: string; note: string };
export const MODELS: ModelChoice[] = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "cheapest, for small and clear changes" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "balanced, the everyday choice" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "strong, for bigger changes" },
  { id: "claude-fable-5-1", label: "Fable 5.1", note: "strongest, for the hardest work" },
];
export const MODEL_IDS = MODELS.map((m) => m.id);
export const EFFORTS: Effort[] = ["low", "medium", "high", "max"];
export const MAX_TURNS_RANGE = { min: 5, max: 100 };

export type Tier = { model: string; effort: Effort; maxTurns: number };

// Ordered cheap to strong. Index 0..3 matches S, M, L, XL.
export const TIERS: Tier[] = [
  { model: "claude-haiku-5-5", effort: "low", maxTurns: 15 },
  { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 30 },
  { model: "claude-opus-5-5", effort: "high", maxTurns: 50 },
  { model: "claude-fable-5-1", effort: "high", maxTurns: 80 },
];

const BASE_INDEX: Record<Complexity, number> = { S: 0, M: 1, L: 2, XL: 3 };
const clamp = (n: number) => Math.max(0, Math.min(TIERS.length - 1, n));

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
  failedAttempts = 0
): Recommendation {
  const known = isComplexity(complexity);
  const base = known ? BASE_INDEX[complexity] : 1; // unknown size: middle of the road
  const shift = bias === "saver" ? -1 : bias === "max" ? 1 : 0;
  const step = Math.max(0, Math.min(3, failedAttempts));
  const index = clamp(base + shift + step);
  const parts = [known ? `${complexity} sized idea` : "size not estimated yet"];
  if (shift) parts.push(shift < 0 ? "project set to save money" : "project set to maximum quality");
  if (step) parts.push(`stepping up after ${step} failed attempt${step > 1 ? "s" : ""}`);
  return { ...TIERS[index], index, reason: parts.join(", ") };
}

export type Override = { model?: unknown; effort?: unknown; maxTurns?: unknown };

// Validate user choices against the allow-lists; anything missing or invalid
// falls back to the recommendation. Returns the tier to run plus whether the
// user changed anything.
export function resolveTier(rec: Recommendation, o: Override = {}): { tier: Tier; overridden: boolean } {
  const model = typeof o.model === "string" && MODEL_IDS.includes(o.model) ? o.model : rec.model;
  const effort = typeof o.effort === "string" && (EFFORTS as string[]).includes(o.effort) ? (o.effort as Effort) : rec.effort;
  const n = Number(o.maxTurns);
  const maxTurns =
    Number.isFinite(n) && n >= MAX_TURNS_RANGE.min && n <= MAX_TURNS_RANGE.max ? Math.round(n) : rec.maxTurns;
  return {
    tier: { model, effort, maxTurns },
    overridden: model !== rec.model || effort !== rec.effort || maxTurns !== rec.maxTurns,
  };
}

export const modelLabel = (id: string | null | undefined) => MODELS.find((m) => m.id === id)?.label ?? id ?? "default";

// Models for the quick planning calls Idea HQ makes itself (server key, so
// cost matters to the owner). Reasoning-heavy ones stay on the strong model.
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
export const LEARN_TIER: Tier = { model: "claude-sonnet-5-5", effort: "high", maxTurns: 40 };
