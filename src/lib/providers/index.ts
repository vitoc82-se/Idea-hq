import { claude } from "./claude";
import { openai } from "./openai";
import type { ProviderAdapter, ProviderId } from "./types";

export * from "./types";
export { claude, openai };

const ALL: Record<ProviderId, ProviderAdapter> = { claude, openai };

export const PROVIDER_IDS = Object.keys(ALL) as ProviderId[];

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === "string" && x in ALL;
}

// Unknown or missing ids fall back to Claude, the original behavior.
export function getProvider(id: string | null | undefined): ProviderAdapter {
  return isProviderId(id) ? ALL[id] : claude;
}

// A provider a user may pick: Claude always; others only once enabled.
export function listProviders(opts: { enabledOnly?: boolean } = {}): ProviderAdapter[] {
  return PROVIDER_IDS.map((id) => ALL[id]).filter((p) => !opts.enabledOnly || p.enabled());
}

export function allModelChoices() {
  return listProviders().flatMap((p) => p.models.map((m) => ({ ...m, provider: p.id })));
}
