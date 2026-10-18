import { LIMITS } from "./constants";
import { cleanText } from "./sanitize";
import type { Note } from "./notes";

// Turns the project's internal knowledge into DRAFT customer-facing help notes.
// The owner reviews every one; drafts are never used until confirmed.

export function buildNotesDraftPrompt(projectName: string, internalContext: string, existing: Note[]): string {
  return [
    `You write the public help notes for "${projectName}", a product whose customers are ordinary people, not developers.`,
    "Below is INTERNAL knowledge about the product. Turn only what a customer could do or needs to know into short how-to notes.",
    "Rules:",
    "- Customer-facing, plain everyday language, no code, no file names, no technology names, no infrastructure, no secrets, no internal process.",
    "- Only include things the knowledge actually states. If something is unclear, leave it out. Never invent features, prices, deadlines or policies.",
    "- Do NOT write notes about orders, payments, invoices, refunds, subscriptions, accounts, passwords, privacy or legal matters: those are handled by people.",
    `- At most 10 notes. Each has a short title (under 60 characters) and a text of at most 500 characters.`,
    existing.length ? `- These titles already exist, do not repeat them: ${existing.map((n) => n.title).join("; ")}` : "",
    "",
    'Return ONLY a JSON array like [{"title":"...","text":"..."}].',
    "",
    "<internal_knowledge>",
    internalContext.slice(0, 20000),
    "</internal_knowledge>",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseNotesDraft(text: string, existing: Note[]): Note[] {
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(a, b + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const have = new Set(existing.map((n) => n.title.toLowerCase()));
  const out: Note[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = cleanText(o.title, LIMITS.noteTitleMax);
    const body = cleanText(o.text, LIMITS.noteTextMax);
    if (!title || !body || have.has(title.toLowerCase())) continue;
    have.add(title.toLowerCase());
    out.push({ id: "d" + Math.random().toString(36).slice(2, 10), title, text: body, status: "needs_review" });
    if (out.length >= 10) break;
  }
  return out;
}
