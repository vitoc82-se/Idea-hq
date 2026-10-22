import { SIZE_NAMES } from "./sizes";
import type { Size } from "./size";

// What a person's own runs have actually cost and taken, by size, so the defaults in sizes.ts can be read next to it.
// This file is plain data in and out so the idea page can use it; reading the runs is in history-store.ts.
// Recorded per run: the turns and cost (from the run's last status line), the idea's size when the run started, and how
// long each stage of the workflow took.

export type StageMs = { prepare?: number; ai?: number; handover?: number; test?: number; save?: number; total?: number };

export type RangeSummary = {
  count: number;
  turns: [number, number];
  minutes: [number, number] | null; // whole minutes of workflow time; null until enough runs have times
  aiMinutes: number | null; // the middle run's time in the AI stage
  usd: [number, number] | null;
};

export type SizeHistory = Partial<Record<Size, RangeSummary>>;

export type HistoryRun = { turns: number | null; costUsd: number | null; size: string | null; stageMs: unknown };

export const MIN_RUNS = 3; // fewer than this is an anecdote, not a range
const KEEP = 20; // the most recent runs of each size

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);

function spread(values: number[]): [number, number] {
  const v = [...values].sort((a, b) => a - b);
  // From ten runs on, the odd outlier at each end is left out; below that, every run counts.
  if (v.length >= 10) {
    const cut = Math.floor(v.length * 0.1);
    return [v[cut], v[v.length - 1 - cut]];
  }
  return [v[0], v[v.length - 1]];
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
}

// `runs` newest first. Only the three sizes a run can have: an Epic is split, not run.
export function summarizeHistory(runs: HistoryRun[]): SizeHistory {
  const out: SizeHistory = {};
  for (const size of ["S", "M", "L"] as const) {
    const own = runs.filter((r) => r.size === size && num(r.turns) != null).slice(0, KEEP);
    if (own.length < MIN_RUNS) continue;
    const turns = spread(own.map((r) => r.turns as number));
    const times = own.map((r) => num((r.stageMs as StageMs | null)?.total)).filter((x): x is number => x != null);
    const ai = own.map((r) => num((r.stageMs as StageMs | null)?.ai)).filter((x): x is number => x != null);
    const costs = own.map((r) => num(r.costUsd)).filter((x): x is number => x != null);
    const wall = times.length >= MIN_RUNS ? spread(times) : null;
    const usd = costs.length >= MIN_RUNS ? spread(costs) : null;
    out[size] = {
      count: own.length,
      turns,
      minutes: wall ? [Math.max(1, Math.floor(wall[0] / 60000)), Math.max(1, Math.ceil(wall[1] / 60000))] : null,
      aiMinutes: ai.length >= MIN_RUNS ? Math.max(1, Math.round(median(ai) / 60000)) : null,
      usd: usd ? [Math.round(usd[0] * 100) / 100, Math.round(usd[1] * 100) / 100] : null,
    };
  }
  return out;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// "Your last 5 Quick changes took 4 to 7 minutes and cost $0.01 to $0.04." Empty until there are minutes or a cost to show.
export function historyLine(size: Size, h: RangeSummary | undefined, opts: { withCost?: boolean } = {}): string {
  if (!h) return "";
  const minutes = h.minutes ? `${h.minutes[0]} to ${h.minutes[1]} minutes` : "";
  const cost = opts.withCost !== false && h.usd ? `${money(h.usd[0])} to ${money(h.usd[1])}` : "";
  if (!minutes && !cost) return "";
  return `Your last ${h.count} ${SIZE_NAMES[size]} changes ${minutes && cost ? `took ${minutes} and cost ${cost}` : minutes ? `took ${minutes}` : `cost ${cost}`}.`;
}
