// Shared constants + helpers for the Ideas board and detail pages.
import { sizeOptionLabel } from "@/lib/runs/sizes";

export interface Idea {
  id: string;
  projectId: string;
  parentId: string | null;
  project?: { name: string; color: string | null } | null;
  _count?: { children: number; tickets?: number }; // child stories (an idea with >0 is an "epic"), and linked support tickets
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  tags: string[];
  blockedBy: string[];
  complexity: string | null; // effort: S, M, L, XL
  impact: string | null; // value: low, medium, high
  scope: string | null;
  aiEstimatedAt: string | null;
  plan: string | null;
  plannedAt: string | null;
  closureNote: string | null;
  closedAt: string | null;
  kind: string; // idea | bug
  severity: string | null; // bugs only
  repro: string | null; // bugs only: steps to reproduce
  createdAt: string;
  // From the ideas list only: the latest build and, for an idea split into steps, the steps (for the stage line on the board).
  latestRun?: { id: string; status: string; kind: string; checksState: string | null } | null;
  epic?: { children: { id: string; status: string }[]; nextId: string | null } | null;
}

// A project this hub tracks ideas for.
export interface Project {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  context: string;
  contextSourceUrl: string | null;
  contextUpdatedAt: string;
  _count?: { ideas: number };
  monthlyCapUsd?: number | null;
  repoOwner?: string | null;
  spend?: { monthUsd: number; runs: number; unpriced: number };
  freshness?: { behind: number | null; stale: boolean; workflowUpdate: boolean };
}

// Lightweight reference to another idea (for dependency pickers / links).
export interface IdeaRef {
  id: string;
  title: string;
  status: string;
}

// A child story under an epic, as shown on the epic's detail page.
export interface StoryChild {
  id: string;
  title: string;
  status: string;
  complexity: string | null;
  impact: string | null;
}

export const STATUSES = [
  { value: "new", label: "New" },
  { value: "considering", label: "Considering" },
  { value: "building", label: "In progress" }, // set by itself when the AI starts a build; the stage line says where it is
  { value: "done", label: "Done" },
  { value: "parked", label: "Parked" },
];

export const PRIORITIES = [
  { value: "none", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const IMPACTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// What a size means for the AI (turns, minutes), not hours of human work. See lib/runs/sizes.ts.
export const COMPLEXITIES = (["S", "M", "L", "XL"] as const).map((value) => ({ value, label: sizeOptionLabel(value) }));

export const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  considering: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  building: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  done: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  parked: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const IMPACT_STYLES: Record<string, string> = {
  high: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  medium: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  low: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export const COMPLEXITY_STYLES: Record<string, string> = {
  S: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  M: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  L: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  XL: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export const statusLabel = (v: string) =>
  STATUSES.find((s) => s.value === v)?.label || v;

// Numeric weights for sorting.
export const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
export const PRIORITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
export const EFFORT_WEIGHT: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };

// An "epic" is an idea that's been split into child stories — a container, not
// work in itself. Epics are excluded from quick-win / value-effort math.
export function isEpic(idea: Idea): boolean {
  return (idea._count?.children ?? 0) > 0;
}

// A "quick win" is high value for low effort: high impact + small build (S or M).
// Epics never count — the real work is in their stories.
export function isQuickWin(idea: Idea): boolean {
  return (
    !isEpic(idea) &&
    idea.impact === "high" &&
    (idea.complexity === "S" || idea.complexity === "M")
  );
}

// Higher = better bang-for-buck (used for the "quick wins first" sort). Ideas
// missing an estimate sort to the bottom.
export function valueEffortScore(idea: Idea): number {
  const impact = idea.impact ? IMPACT_WEIGHT[idea.impact] : 0;
  const effort = idea.complexity ? EFFORT_WEIGHT[idea.complexity] : 0;
  if (!impact || !effort) return -1;
  return impact / effort;
}

// Normalize a freeform tag list: lowercase, trimmed, de-duped, capped.
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const clean = t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function parseTagInput(value: string): string[] {
  return normalizeTags(value.split(","));
}

// An idea is "blocked" while any idea it depends on hasn't shipped (done).
export function blockingIdeas(idea: Idea, byId: Map<string, Idea>): Idea[] {
  return idea.blockedBy
    .map((id) => byId.get(id))
    .filter((d): d is Idea => !!d && d.status !== "done");
}

// A small, stable palette for tag chips (hashed by tag name).
const TAG_PALETTE = [
  "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300",
];

export function tagStyle(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
