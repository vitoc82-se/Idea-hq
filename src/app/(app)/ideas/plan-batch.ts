import { effectiveSize } from "@/lib/runs/size";
import type { Idea } from "./ideas-shared";

// "Plan them all": for each idea, size it if it has no size, then write its plan, the same two calls as Plan it on the
// idea page. An Epic is sized but not planned: it has to be split into steps first, on its own page.
export const MAX_PER_PRESS = 10; // each idea is one or two AI calls, so one press is capped

export type BatchResult = { planned: string[]; epics: string[]; stopped: string | null; left: number };

type Deps = {
  fetch: typeof fetch;
  onIdea: (idea: Idea) => void; // an idea came back changed
  onSettle: (id: string) => void; // done with this idea, one way or the other
};

async function post(d: Deps, url: string): Promise<{ idea: Idea } | { error: string; limit?: boolean }> {
  try {
    const res = await d.fetch(url, { method: "POST" });
    if (res.ok) return { idea: await res.json() };
    if (res.status === 429) return { error: "Daily AI limit reached. The rest can be planned tomorrow.", limit: true };
    const body = await res.json().catch(() => ({}));
    return { error: typeof body?.error === "string" && body.error ? body.error : "A plan could not be made. Try again in a moment." };
  } catch {
    return { error: "Could not reach Idea HQ to make the plan. Check your connection and try again." };
  }
}

export async function planBatch(ideas: Idea[], d: Deps, max = MAX_PER_PRESS): Promise<BatchResult> {
  const queue = ideas.slice(0, max);
  const out: BatchResult = { planned: [], epics: [], stopped: null, left: Math.max(0, ideas.length - max) };
  const worker = async () => {
    // Check for a stop before taking the next idea, so an idea that is never started stays in the queue and is counted.
    while (!out.stopped && queue.length) {
      const idea = queue.shift()!;
      let current = idea;
      try {
        if (!effectiveSize(current)) {
          const r = await post(d, `/api/ideas/${idea.id}/estimate`);
          if ("error" in r) { out.stopped = r.error; continue; }
          current = { ...idea, ...r.idea, project: idea.project, _count: idea._count, latestRun: idea.latestRun, epic: idea.epic };
          d.onIdea(current);
          if (effectiveSize(current) === "XL") { out.epics.push(idea.id); continue; }
        }
        const r = await post(d, `/api/ideas/${idea.id}/plan`);
        if ("error" in r) { out.stopped = r.error; continue; }
        d.onIdea({ ...current, ...r.idea, project: idea.project, _count: idea._count, latestRun: idea.latestRun, epic: idea.epic });
        out.planned.push(idea.id);
      } finally {
        d.onSettle(idea.id);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  // Whatever was not reached because of a stop is still to do.
  out.left += queue.length;
  queue.forEach((i) => d.onSettle(i.id));
  return out;
}
