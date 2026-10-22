// The journey card and the run panel on the same idea page both show the idea's runs. Whichever one starts, approves
// or cancels something tells the other to look again, so neither shows a stale run.
export const RUNS_CHANGED = "ideahq:runs-changed";

export function announceRunsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RUNS_CHANGED));
}
