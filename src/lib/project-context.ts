import { fenced, DATA_NOTICE } from "./ai-fence";
// The grounding block handed to Claude when it estimates an idea's scope, splits it into stories or writes a build
// prompt. Each project carries its own `context` (its stack, models and how it is organised), assembled from the
// project knowledge, so an estimate for a GrantFinder idea is judged against GrantFinder, not Snapmeal.
//
// That text is a short summary, written by hand or by a scan, and it goes stale. So it is never presented as a complete
// list of what exists, and when the repository's own inventory is available (see repo-inventory.ts and
// project-grounding.ts) it is given next to it and trusted over the summary.
//
// Minimal shape so callers can pass a full Prisma Project or a partial.
export function projectPromptContext(
  project: { name: string; context: string | null },
  inventory?: string | null,
): string {
  const ctx = (project.context || "").trim();
  if (!ctx && !inventory) {
    return `The project is "${project.name}". No architecture context has been added for it yet, so estimate conservatively from the title and notes alone and say in the scope that project context is missing.`;
  }
  const parts: string[] = [];
  if (ctx) {
    parts.push(
      `Below is a short summary of the project "${project.name}", written by its owner or by a scan of the repository. Ground what you write in it: reuse the routes, data models, libraries and patterns shown, do not invent files or endpoints, and do not propose building something that it (or the inventory) shows already exists. The summary can be out of date and is NOT a complete list of what exists: never say that something does not exist, or has to be built from scratch, only because the summary does not mention it. Say it was not mentioned and that the repository should be checked first. ${DATA_NOTICE}`,
      fenced("project-context", ctx),
    );
  } else {
    parts.push(`The project is "${project.name}". No summary has been written for it yet.`);
  }
  if (inventory) {
    parts.push(
      `The inventory below was read from the repository just now. It lists every data model, page, API route, code folder, library and scheduled job by name, so it is more current than the summary: when the two disagree, trust the inventory. Look for the things the idea needs by name before you say they are missing (for example support tickets, email sending, billing, a scheduled job). Only when nothing like them is listed may you say they are not in the repository. ${DATA_NOTICE}`,
      fenced("repo-inventory", inventory),
    );
  }
  return parts.join("\n\n");
}
