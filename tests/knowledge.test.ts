import { describe, it, expect } from "vitest";
import {
  parseKnowledge, knowledgeFor, setSection, mergeAiSections, confirmAll, completeness, assembleContext, selectMemory,
  renderMarkdown, parseMarkdown, withClaudeImport, SECTION_DEFS, CORE_SECTION_COUNT, CLAUDE_IMPORT_LINE, type Knowledge,
} from "@/lib/knowledge";

const NOW = new Date("2026-10-18T10:00:00Z");
const base = (): Knowledge => ({ sections: {} });

describe("parseKnowledge / knowledgeFor", () => {
  it("tolerates null, junk and old shapes", () => {
    expect(parseKnowledge(null)).toEqual({ sections: {} });
    expect(parseKnowledge("nope")).toEqual({ sections: {} });
    expect(parseKnowledge({ sections: { what: { text: "  " }, bogus: { text: "x" } } }).sections).toEqual({});
  });
  it("keeps valid sections and defaults a bad source or status", () => {
    const k = parseKnowledge({ sections: { what: { text: "A shop", source: "weird", status: "weird", updatedAt: "2026-01-01T00:00:00Z" } }, learnedSha: "abc" });
    expect(k.sections.what).toMatchObject({ text: "A shop", source: "imported", status: "needs_review" });
    expect(k.learnedSha).toBe("abc");
  });
  it("imports an old free-text context as 'Other notes' so nothing is lost", () => {
    const k = knowledgeFor(null, "Old pasted ARCHITECTURE");
    expect(k.sections.notes).toMatchObject({ text: "Old pasted ARCHITECTURE", source: "imported" });
    expect(knowledgeFor({ sections: {} }, "ignored once structured").sections.notes).toBeUndefined();
  });
});

describe("mergeAiSections", () => {
  it("fills empty sections as needing review", () => {
    const k = mergeAiSections(base(), { what: "A shop", stack: "Next.js" }, "quick-draft", { now: NOW });
    expect(k.sections.what).toMatchObject({ text: "A shop", source: "quick-draft", status: "needs_review" });
  });
  it("never overwrites what the user wrote or confirmed", () => {
    let k = setSection(base(), "what", "Mine", "you", "needs_review", NOW);
    k = setSection(k, "stack", "Confirmed stack", "quick-draft", "confirmed", NOW);
    k = mergeAiSections(k, { what: "AI says", stack: "AI stack", run: "npm test" }, "learn-run", { now: NOW });
    expect(k.sections.what?.text).toBe("Mine");
    expect(k.sections.stack?.text).toBe("Confirmed stack");
    expect(k.sections.run?.text).toBe("npm test");
  });
  it("force replaces even protected sections", () => {
    const k = mergeAiSections(setSection(base(), "what", "Mine", "you", "confirmed"), { what: "New" }, "learn-run", { force: true });
    expect(k.sections.what?.text).toBe("New");
  });
  it("ignores empty AI output", () => {
    const k = setSection(base(), "what", "Keep", "quick-draft", "needs_review");
    expect(mergeAiSections(k, { what: "  " }, "quick-draft").sections.what?.text).toBe("Keep");
  });
});

describe("completeness", () => {
  it("is 0 when empty and 100 when all core sections are confirmed", () => {
    expect(completeness(base())).toMatchObject({ filled: 0, confirmed: 0, percent: 0, total: CORE_SECTION_COUNT });
    let k = base();
    for (const d of SECTION_DEFS.filter((s) => s.core)) k = setSection(k, d.id, "x", "you", "needs_review");
    expect(completeness(k).percent).toBe(67);
    expect(completeness(confirmAll(k)).percent).toBe(100);
  });
  it("lists the missing core sections and ignores 'notes'", () => {
    const k = setSection(setSection(base(), "what", "x", "you", "confirmed"), "notes", "n", "you", "confirmed");
    expect(completeness(k).missing).not.toContain("what");
    expect(completeness(k).missing).not.toContain("notes");
    expect(completeness(k).missing).toContain("stack");
  });
});

describe("assembleContext and memory", () => {
  it("writes the sections in a fixed order, then what was learned", () => {
    let k = setSection(base(), "stack", "Next.js", "you", "confirmed");
    k = setSection(k, "what", "A shop", "you", "confirmed");
    const text = assembleContext(k, [{ kind: "change", text: "Shipped dark mode", pinned: false, createdAt: "2026-10-01" }]);
    expect(text.indexOf("What it is")).toBeLessThan(text.indexOf("Technology"));
    expect(text).toContain("## Learned while working on this project\n- Shipped dark mode");
  });
  it("is empty with nothing known", () => expect(assembleContext(base(), [])).toBe(""));
  it("always includes pinned facts, then recent ones, within the budget", () => {
    const entries = [
      { kind: "user", text: "PINNED RULE", pinned: true, createdAt: "2026-01-01" },
      ...Array.from({ length: 30 }, (_, i) => ({ kind: "change", text: `change ${i}`, pinned: false, createdAt: `2026-02-${String(i + 1).padStart(2, "0")}` })),
    ];
    const picked = selectMemory(entries);
    expect(picked.some((e) => e.text === "PINNED RULE")).toBe(true);
    expect(picked.filter((e) => !e.pinned)).toHaveLength(12);
    expect(picked.find((e) => e.text === "change 29")).toBeTruthy();
    expect(picked.find((e) => e.text === "change 0")).toBeUndefined();
  });
  it("drops entries beyond the character budget instead of blowing up the prompt", () => {
    const big = Array.from({ length: 5 }, (_, i) => ({ kind: "change", text: "x".repeat(2000), pinned: false, createdAt: `2026-03-0${i + 1}` }));
    expect(selectMemory(big).length).toBeLessThanOrEqual(2);
  });
});

describe("repo copy", () => {
  const k = mergeAiSections(base(), { what: "A shop", stack: "Next.js\nPrisma", gotchas: "Do not edit generated files" }, "learn-run", { now: NOW });
  it("round-trips through markdown", () => {
    const md = renderMarkdown(k, "Shop");
    expect(md).toContain("# Shop: project knowledge");
    expect(md).toContain("## Technology");
    const back = parseMarkdown(md);
    expect(back.what).toBe("A shop");
    expect(back.stack).toBe("Next.js\nPrisma");
    expect(back.gotchas).toBe("Do not edit generated files");
  });
  it("keeps text under unknown headings as notes instead of dropping it", () => {
    const back = parseMarkdown("## What it is and who it is for\nA shop\n\n## Deployment secrets policy\nNever commit .env");
    expect(back.what).toBe("A shop");
    expect(back.notes).toContain("deployment secrets policy");
    expect(back.notes).toContain("Never commit .env");
  });
  it("ignores empty sections and html comments", () => {
    expect(parseMarkdown("## Technology\n<!-- note -->\n")).toEqual({});
  });
  it("adds the import to CLAUDE.md without touching what is there, and only once", () => {
    const fresh = withClaudeImport(null);
    expect(fresh).toContain(CLAUDE_IMPORT_LINE);
    const existing = withClaudeImport("# My rules\n\nBe nice.");
    expect(existing.startsWith("# My rules\n\nBe nice.")).toBe(true);
    expect(existing).toContain(CLAUDE_IMPORT_LINE);
    expect(withClaudeImport(existing)).toBe(existing);
  });
});
