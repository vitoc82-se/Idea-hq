import { isPracticeTitle } from "./practice";

// An idea has to be sized before the AI may implement it: the model and the number of turns are picked from the size,
// so a small change is not run on an expensive setup. The size comes from the AI estimate or from the person setting
// the Effort. The setup journey's practice idea counts as small whatever an older row says.
export type Size = "S" | "M" | "L" | "XL";

export function effectiveSize(idea: { complexity?: string | null; title?: string | null } | null | undefined): Size | null {
  const c = idea?.complexity;
  if (c === "S" || c === "M" || c === "L" || c === "XL") return c;
  return isPracticeTitle(idea?.title) ? "S" : null;
}

export const SIZE_FIRST_MESSAGE =
  "Size this idea first: press Estimate the build on the idea, or set its Effort yourself. The AI picks its model and its number of turns from the size, so a small change does not run on an expensive setup.";
