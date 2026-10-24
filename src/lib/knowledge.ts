// What Idea HQ knows about a project. Stored in Idea HQ (always), optionally
// exported into the user's repo. The AI-facing `Project.context` text is
// *assembled* from these sections plus the project's memory, so every existing
// reader keeps working.

export type SectionId = "what" | "stack" | "structure" | "run" | "rules" | "gotchas" | "notes";
export type SectionSource = "quick-draft" | "learn-run" | "you" | "imported";
export type SectionStatus = "needs_review" | "confirmed";

export type Section = { text: string; source: SectionSource; status: SectionStatus; updatedAt: string };
// What a scan found for a topic the owner has confirmed or written. It is never applied by itself: it waits here until
// the owner uses it or keeps their own text.
export type Proposal = { text: string; source: "quick-draft" | "learn-run"; at: string };
export type Knowledge = {
  sections: Partial<Record<SectionId, Section>>;
  proposals?: Partial<Record<SectionId, Proposal>>; // suggested changes to confirmed topics, waiting for the owner
  dismissed?: Partial<Record<SectionId, string[]>>; // fingerprints of suggestions the owner turned down, so they do not come back unchanged
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
  const proposals = r.proposals && typeof r.proposals === "object" ? (r.proposals as Record<string, unknown>) : {};
  for (const def of SECTION_DEFS) {
    const p = proposals[def.id] as Partial<Proposal> | undefined;
    if (p && typeof p.text === "string" && p.text.trim()) {
      out.proposals = { ...out.proposals, [def.id]: { text: p.text.slice(0, MAX_SECTION_CHARS), source: p.source === "learn-run" ? "learn-run" : "quick-draft", at: typeof p.at === "string" ? p.at : new Date(0).toISOString() } };
    }
  }
  const dismissed = r.dismissed && typeof r.dismissed === "object" ? (r.dismissed as Record<string, unknown>) : {};
  for (const def of SECTION_DEFS) {
    const d = dismissed[def.id];
    if (Array.isArray(d)) {
      const list = d.filter((x): x is string => typeof x === "string").slice(-5);
      if (list.length) out.dismissed = { ...out.dismissed, [def.id]: list };
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
  return withoutProposal({ ...k, sections }, id); // new text for the topic settles any earlier suggestion
}

function withoutProposal(k: Knowledge, id: SectionId): Knowledge {
  if (!k.proposals?.[id]) return k;
  const proposals = { ...k.proposals };
  delete proposals[id];
  return { ...k, proposals: Object.keys(proposals).length ? proposals : undefined };
}

// The same text in other words of spacing: used to tell "the scan found the same thing" from "the scan found something else".
const normalize = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
export const sameText = (a: string, b: string) => normalize(a) === normalize(b);
// A short fingerprint of a suggestion, to remember that the owner turned it down.
export function fingerprint(t: string): string {
  let h = 5381;
  for (const ch of normalize(t)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export type MergeResult = { knowledge: Knowledge; applied: SectionId[]; proposed: SectionId[]; unchanged: SectionId[] };

// Fill sections from an AI pass without trampling what the user already edited or confirmed. A topic the user owns
// (confirmed, or written by them) is never changed by a scan: when the scan found something different it becomes a
// suggestion that waits for the owner (see `proposals`), instead of being thrown away unseen. `force` is for an
// explicit "redo everything".
export function mergeAiSectionsDetailed(k: Knowledge, incoming: Partial<Record<SectionId, string>>, source: "quick-draft" | "learn-run", opts: { force?: boolean; now?: Date } = {}): MergeResult {
  let next = k;
  const applied: SectionId[] = [];
  const proposed: SectionId[] = [];
  const unchanged: SectionId[] = [];
  const now = (opts.now ?? new Date()).toISOString();
  for (const def of SECTION_DEFS) {
    const text = incoming[def.id];
    if (!text || !text.trim()) continue;
    const cur = k.sections[def.id];
    const protectedByUser = cur && (cur.status === "confirmed" || cur.source === "you");
    if (protectedByUser && !opts.force) {
      if (sameText(cur.text, text)) { unchanged.push(def.id); next = withoutProposal(next, def.id); continue; }
      if (k.dismissed?.[def.id]?.includes(fingerprint(text))) { unchanged.push(def.id); continue; }
      next = { ...next, proposals: { ...next.proposals, [def.id]: { text: text.trim().slice(0, MAX_SECTION_CHARS), source, at: now } } };
      proposed.push(def.id);
      continue;
    }
    next = setSection(next, def.id, text, source, "needs_review", opts.now);
    applied.push(def.id);
  }
  return { knowledge: next, applied, proposed, unchanged };
}

export function mergeAiSections(k: Knowledge, incoming: Partial<Record<SectionId, string>>, source: "quick-draft" | "learn-run", opts: { force?: boolean; now?: Date } = {}): Knowledge {
  return mergeAiSectionsDetailed(k, incoming, source, opts).knowledge;
}

// The owner takes the suggested text (that is a decision, so the topic counts as confirmed), or keeps their own and
// the same suggestion is not offered again.
export function acceptProposal(k: Knowledge, id: SectionId, now = new Date()): Knowledge {
  const p = k.proposals?.[id];
  if (!p) return k;
  return setSection(k, id, p.text, p.source, "confirmed", now);
}
export function dismissProposal(k: Knowledge, id: SectionId): Knowledge {
  const p = k.proposals?.[id];
  if (!p) return k;
  const seen = [...(k.dismissed?.[id] ?? []), fingerprint(p.text)].slice(-5);
  return { ...withoutProposal(k, id), dismissed: { ...k.dismissed, [id]: seen } };
}
export const pendingProposals = (k: Knowledge): SectionId[] => SECTION_DEFS.filter((d) => k.proposals?.[d.id]).map((d) => d.id);

// What the page, the project list and an idea say about how current the knowledge is. It only says "up to date" when a
// scan compared it with the repo and the owner has settled every difference; the number of commits alone says only how
// long ago that was.
export const STALE_AFTER_COMMITS = 20;
export type KnowledgeNotice = { level: "ok" | "review" | "stale"; text: string };
export function knowledgeNotice(input: { proposals: number; behind: number | null; learnedAt?: string | null }): KnowledgeNotice {
  if (input.proposals > 0) {
    return { level: "review", text: `The latest scan suggests changes to ${input.proposals} topic${input.proposals === 1 ? "" : "s"} you confirmed. Until you review them, the AI still works from the old text.` };
  }
  if (typeof input.behind === "number" && input.behind >= STALE_AFTER_COMMITS) {
    return { level: "stale", text: `The repo has ${input.behind} new commits since the last scan, so estimates and plans may miss recent changes.` };
  }
  if (!input.learnedAt) return { level: "stale", text: "The project has not been scanned yet, so estimates and plans work from what you wrote." };
  return { level: "ok", text: typeof input.behind === "number" && input.behind > 0 ? `Compared with the repo at the last scan, ${input.behind} commit${input.behind === 1 ? "" : "s"} ago.` : "Compared with the repo at the last scan." };
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
