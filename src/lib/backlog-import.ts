import { fenced, DATA_NOTICE } from "./ai-fence";
// Bringing an existing backlog (TODO.md, Notion export, notes) into Idea HQ:
// find likely files in the repo, have the AI read the text and list the ideas
// it holds, let the owner tick what to import.

export type ImportItem = { title: string; notes: string; done: boolean };

export const MAX_SOURCE_CHARS = 30_000;
export const MAX_ITEMS = 80;
export const MAX_IMPORT = 100;

const TEXT_EXT = /\.(md|markdown|txt|rst|adoc|csv)$/i;
const NAME = /^(todos?|backlog|roadmap|ideas?|wish-?list|feature-?requests?|features?|tasks?|next|later)(\.[a-z]+)?$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor|\.next|\.git|\.github|\.idea-hq|coverage|test|tests|__tests__|fixtures)\//i;

// Files that look like a backlog, best first (shallow before deep, TODO before the rest).
export function findBacklogFiles(paths: string[], max = 8): string[] {
  const hits: { path: string; score: number }[] = [];
  for (const p of paths) {
    if (SKIP_DIR.test(p) || !TEXT_EXT.test(p)) continue;
    const parts = p.split("/");
    const base = parts[parts.length - 1];
    const stem = base.replace(/\.[^.]+$/, "");
    const inDocs = parts.length > 1 && /^(docs?|planning|product|notes)$/i.test(parts[parts.length - 2]);
    if (!NAME.test(base) && !/^(todos?|backlog|roadmap)[-_ ]/i.test(stem)) continue;
    if (parts.length > 3) continue;
    const depth = parts.length - 1;
    if (depth > 0 && !inDocs && depth > 1) continue;
    const rank = /^todos?$/i.test(stem) ? 0 : /^backlog$/i.test(stem) ? 1 : /^roadmap$/i.test(stem) ? 2 : 3;
    hits.push({ path: p, score: depth * 10 + rank });
  }
  return hits.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path)).slice(0, max).map((h) => h.path);
}

export function buildImportPrompt(projectName: string, sourceLabel: string, text: string): string {
  return [
    `Read the backlog below for the project "${projectName}" (source: ${sourceLabel}) and list the separate ideas, tasks and feature requests in it.`,
    "Rules:",
    "- One entry per distinct idea. Fold sub-bullets, details and comments that belong to an item into that item's notes.",
    "- title: a short plain-language title, at most 100 characters, in the owner's own words and language. Remove markdown, checkboxes, numbering and emoji.",
    "- notes: the useful detail the owner wrote, at most 400 characters. Empty string if there is none. Do not invent detail.",
    "- done: true only if the text clearly shows it is finished (checked box, strikethrough, in a Done or Completed section, marked done/shipped). Otherwise false.",
    "- Skip headings, introductions, links with no idea attached, and empty items.",
    `- ${DATA_NOTICE}`,
    `- At most ${MAX_ITEMS} entries.`,
    "",
    'Return ONLY a JSON array like [{"title":"...","notes":"...","done":false}].',
    "",
    fenced("backlog", text.slice(0, MAX_SOURCE_CHARS)),
  ].join("\n");
}

function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

export function cleanTitle(s: unknown): string {
  return clean(s, 200).replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").replace(/^(?:[-*+#>]+\s+)?(?:\d+[.)]\s+)?(?:\[[ xX]\]\s+)?/, "").slice(0, 100).trim();
}

export function parseImportItems(text: string): ImportItem[] {
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
  const seen = new Set<string>();
  const out: ImportItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = cleanTitle(o.title);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title, notes: clean(o.notes, 400), done: o.done === true });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// Validates what the browser sends back to import. Never trusts counts or flags.
export function cleanImportRequest(raw: unknown): ImportItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IMPORT) return null;
  const out: ImportItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const o = it as Record<string, unknown>;
    const title = cleanTitle(o.title);
    if (!title) continue;
    out.push({ title, notes: clean(o.notes, 800), done: o.done === true });
  }
  return out.length ? out : null;
}

export function withoutExisting(items: ImportItem[], existingTitles: string[]): { fresh: ImportItem[]; skipped: number } {
  const have = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const fresh: ImportItem[] = [];
  for (const it of items) {
    const k = it.title.toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    fresh.push(it);
  }
  return { fresh, skipped: items.length - fresh.length };
}
