import { describe, it, expect } from "vitest";
import { buildNotesDraftPrompt, parseNotesDraft } from "@/lib/support/notes-draft";
import type { Note } from "@/lib/support/notes";

describe("drafting help notes from project knowledge", () => {
  it("every draft needs the owner's review, never arrives approved", () => {
    const out = parseNotesDraft('Here: [{"title":"Export","text":"Go to Settings.","status":"confirmed"},{"title":"Dark mode","text":"Pick Dark."}]', []);
    expect(out).toHaveLength(2);
    expect(out.every((n) => n.status === "needs_review")).toBe(true);
  });
  it("skips duplicates, junk and empty entries, and caps at ten", () => {
    const existing: Note[] = [{ id: "a", title: "Export", text: "x", status: "confirmed" }];
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `T${i}`, text: `text ${i}` }));
    const out = parseNotesDraft(JSON.stringify([{ title: "export", text: "dup" }, { title: "", text: "x" }, 5, null, ...many]), existing);
    expect(out).toHaveLength(10);
    expect(out.some((n) => n.title.toLowerCase() === "export")).toBe(false);
  });
  it("tolerates non-JSON model output", () => {
    for (const bad of ["", "no list here", "[not json", '{"title":"x"}']) expect(parseNotesDraft(bad, [])).toEqual([]);
  });
  it("the prompt keeps customers' private topics and internals out", () => {
    const p = buildNotesDraftPrompt("Acme", "We use Next.js and Neon.", []);
    expect(p).toMatch(/no code/i);
    expect(p).toMatch(/orders, payments|orders, payments, invoices/i);
    expect(p).toMatch(/<internal-knowledge-[0-9a-f]{12}>/);
  });
});
