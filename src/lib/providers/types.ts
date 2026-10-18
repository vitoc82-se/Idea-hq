// What a vendor must supply for Idea HQ to run its coding agent inside a user's
// GitHub Actions. Everything vendor-specific lives behind this interface (eng
// review D3); no other file should name a vendor.

export type ProviderId = "claude" | "openai";
export type Effort = "low" | "medium" | "high" | "max";
export type Tier = { model: string; effort: Effort; maxTurns: number };
export type ModelChoice = { id: string; label: string; note: string };

export type KeyCheck = { ok: boolean; reason?: string };

export interface ProviderAdapter {
  id: ProviderId;
  label: string; // shown to users, e.g. "Claude (Anthropic)"
  vendor: string; // "Anthropic"
  secretName: string; // the repo secret the workflow reads
  keyHelpUrl: string; // where a user creates the key
  keyHelpText: string; // plain-language pointer for the guide
  models: ModelChoice[];
  tiers: Tier[]; // cheap to strong, index 0..3 = S..XL
  efforts: Effort[];
  learnTier: Tier; // setup for "learn the project" runs
  supportsTurnCap: boolean;
  reportsCost: boolean;
  // Hard limit for a run. Vendors without a turn cap rely on this alone.
  timeoutMinutes(tierIndex: number): number;
  // Providers other than Claude stay off until their live test passed (review D1).
  enabled(): boolean;
  // A tiny authenticated request: proves the key is real before it is written anywhere.
  validateKey(key: string, fetchImpl?: typeof fetch): Promise<KeyCheck>;
  // The workflow step that runs this vendor's agent, indented for a job's `steps:`.
  workflowStep(o: { appSlug: string; maxTurns: number; allowedTools: string }): string;
  // GitHub expression that is true when this vendor's step succeeded.
  successExpr: string;
}
