import { KNOWN_FEATURES } from "@/lib/support/constants";

// Owner-only admin: validating a settings change for one account. Strict: only
// these keys are accepted, so a typo can never silently do nothing.
export const AI_LIMIT_MAX = 1000;

export type UserPatch = {
  approved?: boolean;
  features?: string[];
  aiBuild?: boolean;
  aiDailyLimit?: number | null;
  freeAccess?: boolean;
  aiCredits?: number;
  proRevoked?: boolean;
};

export const CREDITS_MAX = 100000;

const KEYS = ["approved", "features", "aiBuild", "aiDailyLimit", "freeAccess", "aiCredits", "proRevoked"];

export function cleanUserPatch(body: unknown): { ok: true; patch: UserPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !KEYS.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown setting: ${unknown[0].slice(0, 40)}` };
  if (Object.keys(b).length === 0) return { ok: false, error: "Nothing to change." };
  const patch: UserPatch = {};
  if ("approved" in b) {
    if (typeof b.approved !== "boolean") return { ok: false, error: "approved must be true or false." };
    patch.approved = b.approved;
  }
  if ("aiBuild" in b) {
    if (typeof b.aiBuild !== "boolean") return { ok: false, error: "aiBuild must be true or false." };
    patch.aiBuild = b.aiBuild;
  }
  if ("freeAccess" in b) {
    if (typeof b.freeAccess !== "boolean") return { ok: false, error: "freeAccess must be true or false." };
    patch.freeAccess = b.freeAccess;
  }
  if ("proRevoked" in b) {
    if (typeof b.proRevoked !== "boolean") return { ok: false, error: "proRevoked must be true or false." };
    patch.proRevoked = b.proRevoked;
  }
  if ("aiCredits" in b) {
    const v = b.aiCredits;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > CREDITS_MAX) {
      return { ok: false, error: `Run credits must be a whole number from 0 to ${CREDITS_MAX}.` };
    }
    patch.aiCredits = v;
  }
  if ("features" in b) {
    const f = b.features;
    if (!Array.isArray(f) || !f.every((x) => typeof x === "string" && (KNOWN_FEATURES as readonly string[]).includes(x))) {
      return { ok: false, error: "features must be a list of known feature names." };
    }
    patch.features = Array.from(new Set<string>(f as string[]));
  }
  if ("aiDailyLimit" in b) {
    const v = b.aiDailyLimit;
    if (v === null) patch.aiDailyLimit = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= AI_LIMIT_MAX) patch.aiDailyLimit = v;
    else return { ok: false, error: `The daily AI limit must be a whole number from 0 to ${AI_LIMIT_MAX}, or empty for the default.` };
  }
  return { ok: true, patch };
}
