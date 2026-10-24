import { fenced, DATA_NOTICE } from "../ai-fence";

// What the owner has told the AI about an idea beyond its title and notes: corrections ("the settings screen already
// exists"), and a scope or build prompt they wrote or changed by hand. The AI's own first guess is never allowed to
// override either of these.

// The owner's corrections, as a block for any prompt that estimates, splits or plans the idea. Empty when there are none.
export function correctionsBlock(corrections: string | null | undefined): string {
  const t = (corrections || "").trim();
  if (!t) return "";
  return `Corrections from the owner. They know this project better than the summary or your first guess does: treat them as facts and follow them wherever they disagree with anything else here (${DATA_NOTICE}):\n${fenced("owner-corrections", t)}\n`;
}

// "AI scope estimate: ..." or, when the owner wrote or changed it, a line that says so and that it is to be followed.
export function scopeLine(idea: { scope: string | null; scopeEditedAt?: Date | string | null }): string {
  if (!idea.scope) return "AI scope estimate: (not estimated)";
  return idea.scopeEditedAt
    ? `Scope (written or changed by the owner: follow it, do not second-guess it): ${fenced("owner-scope", idea.scope)}`
    : `AI scope estimate: ${idea.scope}`;
}
