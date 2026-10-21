import { fenced, DATA_NOTICE } from "./ai-fence";
// The grounding block handed to Claude when it estimates an idea's scope or
// writes a build prompt. In Snapmeal this was a single hardcoded app context;
// in Idea HQ it is per-project — each Project carries its own `context` (its
// ARCHITECTURE.md / stack / models / deploy flow), so an estimate for a
// GrantFinder idea is judged against GrantFinder, not Snapmeal.
//
// Minimal shape so callers can pass a full Prisma Project or a partial.
export function projectPromptContext(project: {
  name: string;
  context: string | null;
}): string {
  const ctx = (project.context || "").trim();
  if (!ctx) {
    return `The project is "${project.name}". No architecture context has been added for it yet, so estimate conservatively from the title and notes alone and say in the scope that project context is missing.`;
  }
  return `Below is the current architecture and context for the project "${project.name}" — the source of truth for how it is actually built. Ground everything you write in it: reuse the routes, data models, libraries and patterns shown; do not invent files or endpoints that aren't here; and never propose building something that already exists. ${DATA_NOTICE}

${fenced("project-context", ctx)}`;
}
