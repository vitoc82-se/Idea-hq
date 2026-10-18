// What Idea HQ knows about a project. Stored in Idea HQ (always), optionally
// exported into the user's repo. The AI-facing `Project.context` text is
// *assembled* from these sections plus the project's memory, so every existing
// reader keeps working.

export type SectionId = "what" | "stack" | "structure" | "run" | "rules" | "gotchas" | "notes";
export type SectionSource = "quick-draft" | "learn-run" | "you" | "imported";
export type SectionStatus = "needs_review" | "confirmed";

export type Section = { text: string; source: SectionSource; status: SectionStatus; updatedAt: string };
export type Knowledge = {
  sections: Partial<Record<SectionId, Section>>;
  learnedSha?: string; // repo commit the knowledge was last learned from
  learnedAt?: string;
};

export const SECTION_DEFS: { id: SectionId; title: string; hint: string; core: boolean }[] = [
  { id: "what", title: "What it is and who it is for", hint: "The product in two sentences: what it does and who uses it.", core: true },
  { id: "stack", title: "Technology", hint: "Languages, frameworks, database, hosting, important libraries.", core: true },
  { id: "structure", title: "How it is organised", hint: "The important folders, pages, routes and data, and where things live.", core: true },
  { id: "run", title: "How to run, test and ship", hint: "The commands to start, test and build it, and how changes go live.", core: true },
  { id: "rules", title: "Rules and things not to touch", hint: "Conventions to follow and parts the AI must leave alone.", core: true },
  { id: "gotchas", title: "Known quirks and lessons", hint: "Things that surprised people, and mistakes not to repeat.", core: true },
  { id: "notes", title: "Other notes", hint: "Anything else worth knowing.", core: false },
];
export const CORE_SECTION_COUNT = SECTION_DEFS.filter((s) => s.core).length;
const TITLE_TO_ID = new Map(SECTION_DEFS.map((s) => [s.title.toLowerCase(), s.id]));
const MAX_SECTION_CHARS = 6000;

export function isSectionId(x: unknown): x is SectionId {
  return SECTION_DEFS.some((s) => s.id === x);
}

// Reads whatever is stored; tolerates null, old shapes and junk.
export function parseKnowledge(raw: unknown): Knowledge {
  const out: Knowledge = { sections: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const sections = r.sections && typeof r.sections === "object" ? (r.sections as Record<string, unknown>) : {};
  for (const def of SECTION_DEFS) {
    const s = sections[def.id] as Partial<Section> | undefined;
    if (s && typeof s.text === "string" && s.text.trim()) {
      out.sections[def.id] = {
        text: s.text.slice(0, MAX_SECTION_CHARS),
        source: (["quick-draft", "learn-run", "you", "imported"] as string[]).includes(String(s.source)) ? (s.source as SectionSource) : "imported",
        status: s.status === "confirmed" ? "confirmed" : "needs_review",
        updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date(0).toISOString(),
      };
    }
  }
  if (typeof r.learnedSha === "string") out.learnedSha = r.learnedSha;
  if (typeof r.learnedAt === "string") out.learnedAt = r.learnedAt;
  return out;
}

// Old projects only have a free-text context. Keep it as "Other notes" so
// nothing the user wrote is lost, and it still reaches the AI.
export function knowledgeFor(raw: unknown, legacyContext?: string | null): Knowledge {
  const k = parseKnowledge(raw);
  const legacy = (legacyContext || "").trim();
  if (raw == null && legacy) {
    k.sections.notes = { text: legacy.slice(0, MAX_SECTION_CHARS), source: "imported", status: "needs_review", updatedAt: new Date(0).toISOString() };
  }
  return k;
}

export function setSection(k: Knowledge, id: SectionId, text: string, source: SectionSource, status: SectionStatus, now = new Date()): Knowledge {
  const sections = { ...k.sections };
  const t = text.trim().slice(0, MAX_SECTION_CHARS);
  if (!t) delete sections[id];
  else sections[id] = { text: t, source, status, updatedAt: now.toISOString() };
  return { ...k, sections };
}

// Fill sections from an AI pass without trampling what the user already edited or
// confirmed. `force` is for an explicit "redo everything".
export function mergeAiSections(k: Knowledge, incoming: Partial<Record<SectionId, string>>, source: "quick-draft" | "learn-run", opts: { force?: boolean; now?: Date } = {}): Knowledge {
  let next = k;
  for (const def of SECTION_DEFS) {
    const text = incoming[def.id];
    if (!text || !text.trim()) continue;
    const cur = k.sections[def.id];
    const protectedByUser = cur && (cur.status === "confirmed" || cur.source === "you");
    if (protectedByUser && !opts.force) continue;
    next = setSection(next, def.id, text, source, "needs_review", opts.now);
  }
  return next;
}

export function confirmAll(k: Knowledge, now = new Date()): Knowledge {
  const sections: Knowledge["sections"] = {};
  for (const [id, s] of Object.entries(k.sections)) sections[id as SectionId] = { ...s!, status: "confirmed", updatedAt: now.toISOString() };
  return { ...k, sections };
}

export type Completeness = { filled: number; confirmed: number; total: number; percent: number; missing: SectionId[] };
export function completeness(k: Knowledge): Completeness {
  const core = SECTION_DEFS.filter((s) => s.core);
  const filled = core.filter((s) => k.sections[s.id]).length;
  const confirmed = core.filter((s) => k.sections[s.id]?.status === "confirmed").length;
  // A filled section is worth 2/3, a confirmed one the rest.
  const percent = Math.round(((filled * 2 + confirmed) / (core.length * 3)) * 100);
  return { filled, confirmed, total: core.length, percent, missing: core.filter((s) => !k.sections[s.id]).map((s) => s.id) };
}

export type MemoryKind = "change" | "lesson" | "gotcha" | "decision" | "user";
export type MemoryEntry = { id?: string; kind: string; text: string; pinned: boolean; createdAt: Date | string };

const MEMORY_BUDGET_CHARS = 5000;
const MEMORY_RECENT = 12;

// Pinned facts always go in; then the most recent others until the budget is used.
export function selectMemory(entries: MemoryEntry[]): MemoryEntry[] {
  const byNewest = [...entries].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const chosen: MemoryEntry[] = [];
  let used = 0;
  const take = (e: MemoryEntry) => {
    if (used + e.text.length > MEMORY_BUDGET_CHARS) return false;
    chosen.push(e);
    used += e.text.length;
    return true;
  };
  byNewest.filter((e) => e.pinned).forEach(take);
  byNewest.filter((e) => !e.pinned).slice(0, MEMORY_RECENT).forEach(take);
  return chosen;
}

// The text handed to the AI. Sections first, then what has been learned from
// working on the project.
export function assembleContext(k: Knowledge, memory: MemoryEntry[] = []): string {
  const parts: string[] = [];
  for (const def of SECTION_DEFS) {
    const s = k.sections[def.id];
    if (s) parts.push(`## ${def.title}\n${s.text}`);
  }
  const mem = selectMemory(memory);
  if (mem.length) {
    parts.push(`## Learned while working on this project\n${mem.map((m) => `- ${m.text}`).join("\n")}`);
  }
  return parts.join("\n\n").trim();
}

// ---- repo copy (.idea-hq/KNOWLEDGE.md) --------------------------------------

export const KNOWLEDGE_FILE = ".idea-hq/KNOWLEDGE.md";
export const CLAUDE_IMPORT_LINE = `@${KNOWLEDGE_FILE}`;

export function renderMarkdown(k: Knowledge, projectName: string): string {
  const lines = [
    `# ${projectName}: project knowledge`,
    "",
    "<!-- Written by Idea HQ. Edit it in Idea HQ or here; keep the section headings so it can be read back. -->",
    "",
  ];
  for (const def of SECTION_DEFS) {
    const s = k.sections[def.id];
    if (!s) continue;
    lines.push(`## ${def.title}`, "", s.text.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

// Reads a KNOWLEDGE.md back into sections by heading. Text under an unknown
// heading is kept under "Other notes", so nothing is dropped.
export function parseMarkdown(md: string): Partial<Record<SectionId, string>> {
  const out: Partial<Record<SectionId, string>> = {};
  const pieces = md.replace(/\r\n/g, "\n").split(/^##\s+/m).slice(1);
  const extra: string[] = [];
  for (const piece of pieces) {
    const nl = piece.indexOf("\n");
    const heading = (nl === -1 ? piece : piece.slice(0, nl)).trim().toLowerCase().replace(/[:.]+$/, "");
    const body = (nl === -1 ? "" : piece.slice(nl + 1)).replace(/<!--[\s\S]*?-->/g, "").trim();
    if (!body) continue;
    const id = TITLE_TO_ID.get(heading);
    if (id) out[id] = body;
    else extra.push(`**${heading}**\n${body}`);
  }
  if (extra.length) out.notes = [out.notes, ...extra].filter(Boolean).join("\n\n");
  return out;
}

// Make sure the repo's CLAUDE.md pulls the knowledge file in (Claude Code reads
// CLAUDE.md automatically and follows @imports). Never overwrites anything.
export function withClaudeImport(existing: string | null | undefined): string {
  const cur = (existing || "").trimEnd();
  if (cur.includes(CLAUDE_IMPORT_LINE)) return cur + "\n";
  if (!cur) return `# Project notes\n\nProject knowledge, kept up to date by Idea HQ:\n\n${CLAUDE_IMPORT_LINE}\n`;
  return `${cur}\n\n## Project knowledge (Idea HQ)\n\n${CLAUDE_IMPORT_LINE}\n`;
}

// Traffic-light colour for "how well does the AI know this project".
// 0-49 red, 50-79 yellow, 80-94 light green, 95-100 green.
export type KnowledgeTone = "red" | "yellow" | "lime" | "green";
export function knowledgeTone(percent: number): KnowledgeTone {
  if (percent >= 95) return "green";
  if (percent >= 80) return "lime";
  if (percent >= 50) return "yellow";
  return "red";
}

// Full class strings (written out so Tailwind keeps them).
export const KNOWLEDGE_TONE_CLASSES: Record<KnowledgeTone, { button: string; bar: string }> = {
  red: { button: "bg-red-600 hover:bg-red-700 text-white", bar: "bg-red-600" },
  yellow: { button: "bg-yellow-400 hover:bg-yellow-500 text-yellow-950", bar: "bg-yellow-400" },
  lime: { button: "bg-lime-400 hover:bg-lime-500 text-lime-950", bar: "bg-lime-400" },
  green: { button: "bg-green-600 hover:bg-green-700 text-white", bar: "bg-green-600" },
};
