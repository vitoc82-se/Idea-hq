// Short-lived, per-instance cache of full setup checks (they cost GitHub
// requests). Kept in its own module so the engine can invalidate it without a
// circular import with the status code.
import type { SetupStatus } from "./setup";

export const FULL_TTL_MS = 30_000;
export const fullCache = new Map<string, { at: number; value: SetupStatus }>();

export function invalidateSetupCache(projectId: string) {
  for (const k of Array.from(fullCache.keys())) if (k.endsWith(`:${projectId}`)) fullCache.delete(k);
}
export function clearSetupCache() {
  fullCache.clear();
}
