// Run lifecycle (eng review architecture diagram).
//
//   awaiting_approval -> dispatched -> running -> pr_open -> merged
//                    \        \           \          \-> closed
//                     \        \           \-> failed   (any -> cancelled)
//   revise: pr_open -> dispatched again on the same run and PR, back to pr_open when done
//
// Webhooks can arrive duplicated or out of order, so transitions are checked
// against this table and an illegal one is ignored, never applied.

export const RUN_STATUSES = [
  "awaiting_approval",
  "dispatched",
  "running",
  "pr_open",
  "merged",
  "closed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const NEXT: Record<RunStatus, RunStatus[]> = {
  awaiting_approval: ["dispatched", "cancelled"],
  dispatched: ["running", "pr_open", "failed", "cancelled"],
  running: ["pr_open", "failed", "cancelled"],
  pr_open: ["dispatched", "merged", "closed", "failed", "cancelled"],
  merged: [],
  closed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return false;
  return (NEXT[from as RunStatus] || []).includes(to as RunStatus);
}

export function isTerminal(status: string): boolean {
  return (NEXT[status as RunStatus] || []).length === 0;
}

// "Active" = the AI is executing now. Only one such run per project (D2).
export const ACTIVE_STATUSES: RunStatus[] = ["dispatched", "running"];
export function isActive(status: string): boolean {
  return ACTIVE_STATUSES.includes(status as RunStatus);
}

export const WORKFLOW_FILE = "idea-hq.yml";
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
export const RUN_LABEL = (id: string) => `idea-hq ${id}`;
export const runBranch = (id: string) => `idea-hq/${id}`;
