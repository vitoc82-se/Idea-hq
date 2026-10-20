import crypto from "crypto";
import { cleanText } from "./support/sanitize";

// The owner's side of the public "What's new" page: the address key and the entry fields.

export { ENTRY_KINDS, ENTRY_KIND_LABEL, type EntryKind } from "./changelog/kinds";
import { ENTRY_KINDS, type EntryKind } from "./changelog/kinds";

export const KEY_PATTERN = /^ihq_c_[A-Za-z0-9_-]{16}$/;

export function newChangelogKey(): string {
  return "ihq_c_" + crypto.randomBytes(12).toString("base64url");
}

export const TITLE_MAX = 120;
export const BODY_MAX = 1500;

export function cleanKindOf(v: unknown): EntryKind | null {
  return typeof v === "string" && (ENTRY_KINDS as readonly string[]).includes(v) ? (v as EntryKind) : null;
}

export type EntryPatch = { title?: string; body?: string | null; kind?: EntryKind; published?: boolean };

// Strict: only these keys, each checked. Returns a plain-language error for the first problem.
export function cleanEntryPatch(raw: unknown, opts: { requireTitle?: boolean } = {}): { ok: true; patch: EntryPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Send the entry as a JSON object." };
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !["title", "body", "kind", "published"].includes(k));
  if (unknown.length) return { ok: false, error: `Unknown field: ${unknown[0].slice(0, 40)}` };
  const patch: EntryPatch = {};
  if ("title" in b) {
    const t = cleanText(b.title, TITLE_MAX);
    if (!t) return { ok: false, error: "Give the entry a title." };
    patch.title = t;
  } else if (opts.requireTitle) return { ok: false, error: "Give the entry a title." };
  if ("body" in b) {
    if (b.body !== null && typeof b.body !== "string") return { ok: false, error: "The details must be text." };
    const t = b.body === null ? "" : cleanText(b.body, BODY_MAX + 1);
    if (t.length > BODY_MAX) return { ok: false, error: `Keep the details under ${BODY_MAX} characters.` };
    patch.body = t || null;
  }
  if ("kind" in b) {
    const k = cleanKindOf(b.kind);
    if (!k) return { ok: false, error: "The type must be New, Fixed or Improved." };
    patch.kind = k;
  }
  if ("published" in b) {
    if (typeof b.published !== "boolean") return { ok: false, error: "published must be true or false." };
    patch.published = b.published;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };
  return { ok: true, patch };
}
