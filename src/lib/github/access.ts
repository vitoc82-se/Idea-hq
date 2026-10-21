import { db } from "../db";

// "Installed" is not "yours". A GitHub App installed on an organisation covers every repository the app was given,
// including ones a given member cannot open. Idea HQ acts with the app's rights, so before it does anything in a
// repository on someone's behalf it must know THEY may use that repository. At connect time GitHub tells us which
// repos the person can reach through each installation (stored on the GithubInstallation row); this is the check.
//
// yes     = GitHub said so when they connected
// no      = they connected and the repo was not among theirs
// unknown = connected before this check existed, or GitHub did not say: they must reconnect to link a NEW repo,
//           but an already linked project keeps working (nothing is cut off silently).
export type RepoAccess = "yes" | "no" | "unknown";

export class RepoAccessError extends Error {
  status = 403;
}

export const RECONNECT_MESSAGE = "Reconnect GitHub (Projects, Connect GitHub) so Idea HQ can confirm you have access to this repository.";

const key = (owner: string, name: string) => `${owner}/${name}`.toLowerCase();

export function repoAccessFrom(repos: unknown, owner: string, name: string): RepoAccess {
  if (!Array.isArray(repos)) return "unknown";
  return repos.includes(key(owner, name)) ? "yes" : "no";
}

export async function repoAccess(userId: string, installationId: number, owner: string, name: string): Promise<RepoAccess> {
  const row = await db.githubInstallation.findFirst({ where: { userId, id: installationId }, select: { repos: true } });
  // No row at all cannot come from linking a repo (that checks the row); it is an old or removed connection, and GitHub
  // itself refuses the app's token when the installation is gone. Treated like "unknown", not as a person's lack of access.
  return row ? repoAccessFrom(row.repos, owner, name) : "unknown";
}

// Call before using a project's repository. Nothing happens for a project that has no repository yet.
export async function requireRepoAccess(p: { userId: string; installationId: number | null; repoOwner: string | null; repoName: string | null }): Promise<void> {
  if (!p.installationId || !p.repoOwner || !p.repoName) return;
  const access = await repoAccess(p.userId, p.installationId, p.repoOwner, p.repoName);
  if (access === "no") {
    throw new RepoAccessError(`You do not have access to ${p.repoOwner}/${p.repoName} on GitHub (or the connection is gone). Reconnect GitHub to check again, or link a repository you can open.`);
  }
}

type RepoRef = { userId: string; installationId: number | null; repoOwner: string | null; repoName: string | null };

// For routes and reads that should behave as "no repository" (or answer 403) instead of throwing:
// a plain sentence when the person has no access to the project's repository, else null.
export async function repoAccessProblem(p: RepoRef): Promise<string | null> {
  try {
    await requireRepoAccess(p);
    return null;
  } catch (e) {
    if (e instanceof RepoAccessError) return e.message;
    throw e;
  }
}
