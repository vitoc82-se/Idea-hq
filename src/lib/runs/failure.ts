// A plain-language reason when the GitHub workflow of a run fails, from the name of the
// step that broke (read from GitHub). Step names are the ones in the workflow template.

const HINTS: [RegExp, string][] = [
  [/install dependencies/i, "Installing your project's dependencies failed. This is usually a package-lock.json that does not match package.json: run npm install in your repo, commit the updated package-lock.json, and try again."],
  [/run claude code/i, "The AI step failed. Check that the ANTHROPIC_API_KEY secret in your repo is correct and that your Anthropic account has credit and is not over its spending limit."],
  [/run codex/i, "The AI step failed. Check that the OPENAI_API_KEY secret in your repo is correct and that your OpenAI account has credit."],
  [/apply the ai/i, "The AI's changes could not be put onto a clean copy of the branch. Run it again; if it keeps happening, the branch was probably changed by someone else in the meantime."],
  [/verify/i, "Your project's build or tests failed after the change."],
  [/push branch/i, "Saving the change to a branch failed. Check that the Idea HQ app is still allowed to write to this repo."],
  [/check out/i, "GitHub could not check out the repo. Check that the Idea HQ app can still see it."],
];

const AI_STEP = /run claude code|run codex/i;

// `outOfTurns`: the AI step failed and the run had used every turn it was given. That is not a key or credit
// problem, so it gets its own message, with the number the next try will start with.
export function workflowFailureMessage(
  conclusion: string | null | undefined,
  step: string | null,
  url: string | null | undefined,
  outOfTurns?: { cap: number; next: number } | null
): string {
  const link = url || "the Actions tab";
  if (outOfTurns && step && AI_STEP.test(step)) {
    const more = outOfTurns.next > outOfTurns.cap ? ` Press Implement again: the next try starts with up to ${outOfTurns.next} turns.` : " This is already the most turns a run can have, so try a smaller idea or split it into stories.";
    return `The AI used all ${outOfTurns.cap} turns it was given before it finished, so no pull request was opened.${more} Details: ${link}`;
  }
  const what = conclusion === "cancelled" ? "was cancelled" : conclusion === "timed_out" ? "took too long and was stopped" : conclusion === "failure" || !conclusion ? "failed" : `ended as ${conclusion}`;
  const hint = step ? HINTS.find(([re]) => re.test(step))?.[1] : undefined;
  const where = step ? ` at the step "${step}"` : "";
  return `The workflow ${what}${where}. ${hint ? hint + " " : ""}Details: ${link}`;
}
