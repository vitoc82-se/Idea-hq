import type { Size } from "./size";

// How big an idea is, in terms of what the AI has to do (not what a human developer would need). The four stored
// values S, M, L and XL stay; these are the names people see and what each size typically costs the AI. The ranges
// are starting values from real runs. Each person's own history of finished runs (history.ts) is shown next to them once
// there are enough runs of that size. Measured on
// Haiku: two small changes took 7 and 7 to 14 turns, about half a cent each, 4 to 5 minutes (about 2 of them the AI,
// the rest installing, building and testing twice); the README practice run 8 turns and $0.01; a four-file change
// $0.21 and a ten-file one $0.74. Standard and Large are not yet measured.
export const SIZE_NAMES: Record<Size, string> = { S: "Quick", M: "Standard", L: "Large", XL: "Epic" };

type Range = readonly [number, number];
export const SIZE_PROFILE: Record<Size, { turns: Range; minutes: Range; usd: Range; what: string }> = {
  S: { turns: [5, 15], minutes: [4, 8], usd: [0.01, 0.05], what: "one or two files" },
  M: { turns: [15, 35], minutes: [6, 15], usd: [0.1, 0.6], what: "a handful of files" },
  L: { turns: [30, 60], minutes: [12, 30], usd: [0.5, 2.5], what: "a new feature across the app" },
  XL: { turns: [60, 100], minutes: [25, 45], usd: [2, 8], what: "more than one run can safely do" },
};

const isSize = (c: unknown): c is Size => c === "S" || c === "M" || c === "L" || c === "XL";

export function sizeName(c: string | null | undefined): string {
  return isSize(c) ? SIZE_NAMES[c] : "";
}

const money = (n: number) => `$${n < 1 ? n.toFixed(2) : String(Math.round(n * 10) / 10)}`;

// "typically 4 to 8 minutes, $0.01 to $0.05". Minutes and cost are what the owner decides on; the turns (the AI's steps)
// are for the run options, so they are only included when asked for. `withCost` is false for providers that do not report cost.
export function sizeExpectation(c: string | null | undefined, opts: { withCost?: boolean; withTurns?: boolean } = {}): string {
  if (!isSize(c)) return "";
  const p = SIZE_PROFILE[c];
  if (c === "XL") return "too big for one run: split it into steps first";
  const parts = [`${p.minutes[0]} to ${p.minutes[1]} minutes`];
  if (opts.withCost !== false) parts.push(`${money(p.usd[0])} to ${money(p.usd[1])}`);
  if (opts.withTurns) parts.push(`${p.turns[0]} to ${p.turns[1]} turns`);
  return `typically ${parts.join(", ")}`;
}

// The line in a size dropdown. Short, because the dropdown sits in a narrow column; the idea page shows the full expectation.
export function sizeOptionLabel(c: Size): string {
  const p = SIZE_PROFILE[c];
  return c === "XL" ? `${SIZE_NAMES[c]}: split it first` : `${SIZE_NAMES[c]}: ${p.minutes[0]} to ${p.minutes[1]} minutes`;
}
