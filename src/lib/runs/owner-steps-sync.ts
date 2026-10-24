import { db } from "@/lib/db";
import type { GitHubApi } from "@/lib/github/client";
import { logError } from "@/lib/log";
import { ENV_EXAMPLE_FILES, envStepsFromChanges, mergeSteps, namesInEnvExample, parseBuildSteps, readSteps, type StepSource } from "./owner-steps";

type Where = { ideaId: string; i: number; owner: string; repo: string; prNumber: number; baseRef: string; note: string | null };

// Brings an idea's list of "things only you can do" up to date after a build or a revision opened or updated its pull
// request: what the AI said it needs, and what Idea HQ itself found by reading the change. A step that was already there
// keeps its tick. A source that could not be read this time keeps what it had. Never fails the run.
export async function syncOwnerSteps(w: Where, gh: GitHubApi): Promise<void> {
  try {
    const idea = await db.idea.findUnique({ where: { id: w.ideaId }, select: { ownerSteps: true } });
    if (!idea) return;
    const sources: StepSource[] = [];
    const incoming = [];
    // The AI's own list is only replaced when its message has the block; a message without it (a revision that did not
    // mention it, or no message at all) must not wipe the list from the first build.
    const said = parseBuildSteps(w.note);
    if (said) {
      sources.push("ai");
      incoming.push(...said);
    }
    try {
      const files = await gh.prPatches(w.i, w.owner, w.repo, w.prNumber);
      const documented: string[] = [];
      for (const name of ENV_EXAMPLE_FILES) {
        const f = await gh.getFile(w.i, w.owner, w.repo, name, w.baseRef).catch(() => null);
        if (f) documented.push(...namesInEnvExample(f.content));
      }
      sources.push("code");
      incoming.push(...envStepsFromChanges(files, documented));
    } catch (e) {
      logError("owner steps: could not read the change", e);
    }
    if (!sources.length) return;
    const merged = mergeSteps(readSteps(idea.ownerSteps), incoming, sources);
    await db.idea.update({ where: { id: w.ideaId }, data: { ownerSteps: merged } });
  } catch (e) {
    logError("owner steps: could not save", e);
  }
}
