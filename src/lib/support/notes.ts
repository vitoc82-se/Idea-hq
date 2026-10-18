import { LIMITS } from "./constants";
import { cleanText } from "./sanitize";

// "Help notes": the owner-reviewed text the support AI may use. Only notes with
// status "confirmed" are ever shown to a customer-facing process.

export type NoteStatus = "needs_review" | "confirmed";
export type Note = { id: string; title: string; text: string; status: NoteStatus };

export function parseNotes(raw: unknown): Note[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { notes?: unknown }).notes) ? (raw as { notes: unknown[] }).notes : [];
  const out: Note[] = [];
  const seen = new Set<string>();
  for (const n of list) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const title = cleanText(o.title, LIMITS.noteTitleMax);
    const text = cleanText(o.text, LIMITS.noteTextMax);
    let id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(o.id) ? o.id : "";
    if (!title || !text) continue;
    if (!id || seen.has(id)) id = "n" + Math.random().toString(36).slice(2, 10);
    seen.add(id);
    out.push({ id, title, text, status: o.status === "confirmed" ? "confirmed" : "needs_review" });
    if (out.length >= LIMITS.maxNotes) break;
  }
  return out;
}

export function confirmedNotes(raw: unknown): Note[] {
  return parseNotes(raw).filter((n) => n.status === "confirmed");
}

export function notesToStored(notes: Note[]): { notes: Note[] } {
  return { notes: parseNotes({ notes }) };
}

export function notesBlock(notes: Note[]): string {
  let total = 0;
  const parts: string[] = [];
  for (const n of notes) {
    const part = `## ${n.title}\n${n.text}`;
    if (total + part.length > LIMITS.notesTotalMax) break;
    total += part.length;
    parts.push(part);
  }
  return parts.join("\n\n");
}
