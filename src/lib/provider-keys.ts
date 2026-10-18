import { db } from "@/lib/db";
import { github as realGithub, SecretsPermissionError, type GitHubApi } from "@/lib/github/client";
import { sealSecret } from "@/lib/github/seal";
import { getProvider, isProviderId, type KeyCheck } from "@/lib/providers";
import { invalidateSetupCache } from "@/lib/runs/setup-cache";
import { RunError } from "@/lib/runs/engine";

// "Add my key to my repos": the user pastes a provider key once; we check it
// works, seal it to each repo's public key, write it as that repo's Actions
// secret, and forget it. The key is NEVER stored, logged or returned (review D2).

export type RelayResult = { projectId: string; repo: string; ok: boolean; message: string };

type Deps = {
  gh?: GitHubApi;
  fetchImpl?: typeof fetch;
  seal?: (publicKey: string, value: string) => Promise<string>;
  now?: () => number;
};

// Per-user brake against someone using the relay to hammer a provider with guesses.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const attempts = new Map<string, number[]>();
export function clearRelayLimits() {
  attempts.clear();
}
function underLimit(userId: string, now: number): boolean {
  const recent = (attempts.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    attempts.set(userId, recent);
    return false;
  }
  attempts.set(userId, [...recent, now]);
  return true;
}

// Defence in depth: whatever text leaves this module, the key is not in it.
export function redact(text: string, key: string): string {
  return key ? text.split(key).join("[key hidden]") : text;
}

export async function relayProviderKey(
  userId: string,
  projectId: string,
  input: { provider: unknown; key: unknown; alsoProjectIds?: unknown },
  deps: Deps = {}
): Promise<{ results: RelayResult[] }> {
  const gh = deps.gh ?? realGithub;
  const now = (deps.now ?? Date.now)();
  let key = typeof input.key === "string" ? input.key.trim() : "";
  try {
    if (!isProviderId(input.provider)) throw new RunError(400, "Unknown AI provider.");
    const provider = getProvider(input.provider);
    if (!provider.enabled()) throw new RunError(400, `${provider.label} is not available yet.`);
    if (!key) throw new RunError(400, "Paste your API key first.");
    if (key.length > 400) throw new RunError(400, "That is too long to be an API key.");
    if (!underLimit(userId, now)) throw new RunError(429, "Too many attempts. Try again in an hour.");

    const project = await db.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw new RunError(404, "Project not found");

    // Only repos of THIS user's projects, never an arbitrary repo name from the request.
    const extraIds = Array.isArray(input.alsoProjectIds) ? input.alsoProjectIds.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    const extras = extraIds.length ? await db.project.findMany({ where: { userId, id: { in: extraIds } } }) : [];
    const targets: (typeof project)[] = [];
    const seen = new Set<string>();
    for (const p of [project, ...extras]) {
      if (!p.installationId || !p.repoOwner || !p.repoName) continue;
      const k = `${p.installationId}:${p.repoOwner}/${p.repoName}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(p);
    }
    if (!targets.length) throw new RunError(409, "Connect a GitHub repo to this project first.");

    // Prove the key is real before it goes anywhere.
    const check: KeyCheck = await provider.validateKey(key, deps.fetchImpl);
    if (!check.ok) throw new RunError(400, redact(check.reason || "That key was rejected.", key));

    const seal = deps.seal ?? sealSecret;
    const results: RelayResult[] = [];
    for (const p of targets) {
      const repo = `${p.repoOwner}/${p.repoName}`;
      try {
        const pub = await gh.getSecretsPublicKey(p.installationId!, p.repoOwner!, p.repoName!);
        const sealed = await seal(pub.key, key);
        await gh.putSecret(p.installationId!, p.repoOwner!, p.repoName!, provider.secretName, sealed, pub.keyId);
        results.push({ projectId: p.id, repo, ok: true, message: `Saved as ${provider.secretName}.` });
        if (getProvider(p.aiProvider).id === provider.id) {
          await db.project.update({ where: { id: p.id }, data: { secretConfirmed: true } });
        }
        invalidateSetupCache(p.id);
      } catch (e) {
        const message =
          e instanceof SecretsPermissionError
            ? "Idea HQ cannot write secrets here yet. Approve the new permission on GitHub (Settings, Applications), or add the key by hand."
            : redact(e instanceof Error ? e.message : "Could not save the key.", key);
        results.push({ projectId: p.id, repo, ok: false, message });
      }
    }
    return { results };
  } finally {
    key = ""; // best effort: nothing holds the key after this call
  }
}
