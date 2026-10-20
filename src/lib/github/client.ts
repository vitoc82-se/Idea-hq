import crypto from "crypto";

// Thin GitHub App client over fetch. Everything the Implement flow needs and
// nothing more. `GitHubApi` is the seam the run engine depends on, so tests
// swap in a fake instead of mocking fetch.

export class GitHubError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// Writing a repo secret needs the app's "Secrets: write" permission, which an
// installation may not have approved yet.
export class SecretsPermissionError extends GitHubError {
  constructor() {
    super(403, "Idea HQ does not have permission to write secrets in this repo yet.");
  }
}

// GitHub's per-installation limit (about 5,000 requests an hour) was hit. Carries
// how long to wait so callers can back off instead of retrying.
export class GitHubRateLimitError extends GitHubError {
  constructor(message: string, public retryAfterSec: number) {
    super(429, message);
  }
}

export type CheckSummary = {
  state: "pending" | "green" | "red";
  failing: string[];
};

// A comment on a pull request. `bot` is true for GitHub Apps (Vercel, Netlify, ...), whose
// comments are the only ones trusted for preview links.
export type PrComment = { author: string; bot: boolean; body: string };

export interface GitHubApi {
  repoBranch(i: number, owner: string, repo: string, branch: string): Promise<{ sha: string; protected: boolean } | null>;
  secretExists(i: number, owner: string, repo: string, name: string): Promise<boolean>;
  getFile(i: number, owner: string, repo: string, path: string, ref: string): Promise<{ sha: string; content: string } | null>;
  createBranch(i: number, owner: string, repo: string, branch: string, fromSha: string): Promise<void>;
  putFile(i: number, owner: string, repo: string, path: string, branch: string, content: string, message: string, sha?: string): Promise<void>;
  openPr(i: number, owner: string, repo: string, p: { head: string; base: string; title: string; body: string }): Promise<{ number: number }>;
  getPr(i: number, owner: string, repo: string, n: number): Promise<{ number: number; state: string; merged: boolean; headSha: string; baseRef: string; nodeId: string; mergeCommitSha: string | null }>;
  mergePr(i: number, owner: string, repo: string, n: number, sha: string): Promise<{ sha: string }>;
  checkSummary(i: number, owner: string, repo: string, sha: string, requireOwn?: boolean): Promise<CheckSummary>;
  dispatchWorkflow(i: number, owner: string, repo: string, file: string, ref: string, inputs: Record<string, string>): Promise<void>;
  revertPr(i: number, owner: string, repo: string, prNodeId: string, title: string): Promise<{ number: number }>;
  listTree(i: number, owner: string, repo: string, ref: string): Promise<{ paths: string[]; truncated: boolean }>;
  commitsAhead(i: number, owner: string, repo: string, fromSha: string, toRef: string): Promise<number | null>;
  listPrFiles(i: number, owner: string, repo: string, n: number): Promise<string[]>;
  listPrComments(i: number, owner: string, repo: string, n: number): Promise<PrComment[]>;
  failedStep(i: number, owner: string, repo: string, ghRunId: string): Promise<string | null>;
  runNote(i: number, owner: string, repo: string, ghRunId: string): Promise<string | null>;
  getSecretsPublicKey(i: number, owner: string, repo: string): Promise<{ keyId: string; key: string }>;
  putSecret(i: number, owner: string, repo: string, name: string, encryptedValue: string, keyId: string): Promise<void>;
  listDir(i: number, owner: string, repo: string, path: string, ref: string): Promise<string[]>;
  listRepos(i: number): Promise<{ owner: string; name: string; defaultBranch: string }[]>;
  closePr(i: number, owner: string, repo: string, n: number): Promise<void>;
}

import { extractNote } from "../runs/note";

const API = "https://api.github.com";

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

function privateKey(): string {
  // Vercel env vars store newlines as literal \n.
  return (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

export function githubConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET);
}

const tokenCache = new Map<number, { token: string; exp: number }>();

async function raw(token: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "idea-hq",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { res, json };
}

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const jwt = appJwt(process.env.GITHUB_APP_ID || "", privateKey());
  const { res, json } = await raw(jwt, "POST", `/app/installations/${installationId}/access_tokens`);
  if (!res.ok) throw new GitHubError(res.status, "Could not get installation token", json);
  const j = json as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: j.token, exp: Date.parse(j.expires_at) });
  return j.token;
}

// Conditional requests: GitHub answers 304 without counting it against the rate
// limit, so repeated reads of unchanged data are free. Warm serverless
// instances keep this cache between requests.
const etagCache = new Map<string, { etag: string; json: unknown }>();
const ETAG_CACHE_MAX = 400;

export function clearEtagCache() {
  etagCache.clear();
}

export function rateLimitWait(res: { status: number; headers: Headers }, message: string, now = Date.now()): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("retry-after"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const remaining = res.headers.get("x-ratelimit-remaining");
  const limited = res.status === 429 || remaining === "0" || Number.isFinite(retryAfter) && retryAfter > 0 || /rate limit/i.test(message);
  if (!limited) return null;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter);
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - now / 1000));
  return 60;
}

async function call<T>(i: number, method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T | null> {
  const token = await installationToken(i);
  const key = `${i}:${path}`;
  const cached = method === "GET" ? etagCache.get(key) : undefined;
  const { res, json } = await raw(token, method, path, body, cached ? { "If-None-Match": cached.etag } : {});
  if (res.status === 304 && cached) return cached.json as T;
  if (okStatuses.includes(res.status)) return null;
  if (!res.ok) {
    const msg = (json as { message?: string } | null)?.message || res.statusText;
    const wait = rateLimitWait(res, msg);
    if (wait !== null) {
      throw new GitHubRateLimitError(`GitHub is limiting requests for this connection. Try again in about ${Math.max(1, Math.ceil(wait / 60))} minute${wait > 90 ? "s" : ""}.`, wait);
    }
    throw new GitHubError(res.status, `GitHub ${method} ${path}: ${msg}`, json);
  }
  const etag = method === "GET" ? res.headers.get("etag") : null;
  if (etag) {
    if (etagCache.size >= ETAG_CACHE_MAX) etagCache.delete(etagCache.keys().next().value as string);
    etagCache.set(key, { etag, json });
  }
  return json as T;
}

type CheckRun = { name: string; status: string; conclusion: string | null };
type CombinedStatus = { statuses: { context: string; state: string }[] };

// Combine check-runs and commit statuses for one sha. Our workflow reports its
// own verdict (build + tests + AI success) as the `idea-hq/run` status. For an
// implement run that verdict is REQUIRED: no report yet means pending, a failure
// means red, and a repo with no CI of its own is gated on it alone.
export function summarizeChecks(
  runs: CheckRun[],
  statuses: CombinedStatus["statuses"],
  requireOwn = true
): CheckSummary {
  const failing: string[] = [];
  let pending = false;
  for (const r of runs) {
    if (r.status !== "completed") pending = true;
    else if (!["success", "neutral", "skipped"].includes(r.conclusion || "")) failing.push(r.name);
  }
  const own = statuses.find((s) => s.context === "idea-hq/run");
  for (const s of statuses) {
    if (s.context === "idea-hq/run") continue;
    if (s.state === "pending") pending = true;
    else if (s.state !== "success") failing.push(s.context);
  }
  if (requireOwn) {
    if (!own || own.state === "pending") pending = true;
    else if (own.state !== "success") failing.push("idea-hq/run");
  }
  if (failing.length) return { state: "red", failing };
  if (pending) return { state: "pending", failing: [] };
  if (!requireOwn && runs.length === 0 && statuses.length === 0) return { state: "pending", failing: [] };
  return { state: "green", failing: [] };
}

export const github: GitHubApi = {
  async repoBranch(i, owner, repo, branch) {
    const j = await call<{ commit: { sha: string }; protected: boolean }>(i, "GET", `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, undefined, [404]);
    return j ? { sha: j.commit.sha, protected: !!j.protected } : null;
  },
  async secretExists(i, owner, repo, name) {
    const j = await call<{ name: string }>(i, "GET", `/repos/${owner}/${repo}/actions/secrets/${name}`, undefined, [404]);
    return !!j;
  },
  async getFile(i, owner, repo, path, ref) {
    const j = await call<{ sha: string; content: string }>(i, "GET", `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, undefined, [404]);
    return j ? { sha: j.sha, content: Buffer.from(j.content || "", "base64").toString("utf8") } : null;
  },
  async createBranch(i, owner, repo, branch, fromSha) {
    await call(i, "POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
  },
  async putFile(i, owner, repo, path, branch, content, message, sha) {
    await call(i, "PUT", `/repos/${owner}/${repo}/contents/${path}`, {
      message, branch, content: Buffer.from(content).toString("base64"), ...(sha ? { sha } : {}),
    });
  },
  async openPr(i, owner, repo, p) {
    const j = await call<{ number: number }>(i, "POST", `/repos/${owner}/${repo}/pulls`, p);
    return { number: j!.number };
  },
  async getPr(i, owner, repo, n) {
    const j = await call<{ number: number; state: string; merged: boolean; head: { sha: string }; base: { ref: string }; node_id: string; merge_commit_sha: string | null }>(i, "GET", `/repos/${owner}/${repo}/pulls/${n}`);
    return { number: j!.number, state: j!.state, merged: j!.merged, headSha: j!.head.sha, baseRef: j!.base.ref, nodeId: j!.node_id, mergeCommitSha: j!.merge_commit_sha };
  },
  async mergePr(i, owner, repo, n, sha) {
    // `sha` pins the merge to the head we verified, so a late push cannot slip in.
    const j = await call<{ sha: string }>(i, "PUT", `/repos/${owner}/${repo}/pulls/${n}/merge`, { sha, merge_method: "squash" });
    return { sha: j!.sha };
  },
  async checkSummary(i, owner, repo, sha, requireOwn = true) {
    const runs = await call<{ check_runs: CheckRun[] }>(i, "GET", `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`);
    const combined = await call<CombinedStatus>(i, "GET", `/repos/${owner}/${repo}/commits/${sha}/status`);
    return summarizeChecks(runs?.check_runs || [], combined?.statuses || [], requireOwn);
  },
  async dispatchWorkflow(i, owner, repo, file, ref, inputs) {
    await call(i, "POST", `/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`, { ref, inputs });
  },
  async revertPr(i, owner, repo, prNodeId, title) {
    const q = `mutation($id:ID!,$t:String!){revertPullRequest(input:{pullRequestId:$id,title:$t}){revertPullRequest{number}}}`;
    const j = await call<{ data?: { revertPullRequest?: { revertPullRequest?: { number: number } } }; errors?: { message: string }[] }>(i, "POST", "/graphql", { query: q, variables: { id: prNodeId, t: title } });
    const n = j?.data?.revertPullRequest?.revertPullRequest?.number;
    if (!n) throw new GitHubError(422, `Revert failed: ${j?.errors?.[0]?.message || "unknown"}`);
    void owner; void repo;
    return { number: n };
  },
  async listTree(i, owner, repo, ref) {
    const j = await call<{ tree: { path: string; type: string }[]; truncated: boolean }>(i, "GET", `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, undefined, [404, 409]);
    return { paths: (j?.tree || []).filter((t) => t.type === "blob").map((t) => t.path), truncated: !!j?.truncated };
  },
  async commitsAhead(i, owner, repo, fromSha, toRef) {
    const j = await call<{ ahead_by: number }>(i, "GET", `/repos/${owner}/${repo}/compare/${fromSha}...${encodeURIComponent(toRef)}`, undefined, [404, 422]);
    return j ? j.ahead_by : null;
  },
  async listPrFiles(i, owner, repo, n) {
    const j = await call<{ filename: string }[]>(i, "GET", `/repos/${owner}/${repo}/pulls/${n}/files?per_page=100`);
    return (j || []).map((f) => f.filename);
  },
  async runNote(i, owner, repo, ghRunId) {
    const j = await call<{ jobs: { id: number }[] }>(i, "GET", `/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(ghRunId)}/jobs?per_page=5`, undefined, [404]);
    const jobId = j?.jobs?.[0]?.id;
    if (!jobId) return null;
    // The log comes back as plain text (GitHub redirects to a signed address; the token is not forwarded there).
    const { res, json } = await raw(await installationToken(i), "GET", `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`);
    return res.ok && typeof json === "string" ? extractNote(json) : null;
  },
  async failedStep(i, owner, repo, ghRunId) {
    const j = await call<{ jobs: { steps?: { name: string; conclusion: string | null }[] }[] }>(i, "GET", `/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(ghRunId)}/jobs?per_page=10`, undefined, [404]);
    for (const job of j?.jobs ?? []) {
      const bad = (job.steps ?? []).find((s) => s.conclusion === "failure");
      if (bad) return bad.name;
    }
    return null;
  },
  async listPrComments(i, owner, repo, n) {
    try {
      const j = await call<{ user: { login: string; type: string } | null; body: string | null }[]>(i, "GET", `/repos/${owner}/${repo}/issues/${n}/comments?per_page=100`, undefined, [404]);
      return (j || []).map((c) => ({ author: c.user?.login ?? "", bot: c.user?.type === "Bot", body: c.body ?? "" }));
    } catch (e) {
      // Without the permission (or when rate limited) there is simply no preview link.
      if (e instanceof GitHubError && !(e instanceof GitHubRateLimitError) && e.status === 403) return [];
      throw e;
    }
  },
  async getSecretsPublicKey(i, owner, repo) {
    const j = await call<{ key_id: string; key: string }>(i, "GET", `/repos/${owner}/${repo}/actions/secrets/public-key`);
    return { keyId: j!.key_id, key: j!.key };
  },
  async putSecret(i, owner, repo, name, encryptedValue, keyId) {
    try {
      await call(i, "PUT", `/repos/${owner}/${repo}/actions/secrets/${name}`, { encrypted_value: encryptedValue, key_id: keyId });
    } catch (e) {
      if (e instanceof GitHubError && !(e instanceof GitHubRateLimitError) && e.status === 403) throw new SecretsPermissionError();
      throw e;
    }
  },
  async listDir(i, owner, repo, path, ref) {
    const j = await call<{ name: string; type: string }[]>(i, "GET", `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, undefined, [404]);
    return Array.isArray(j) ? j.map((e) => (e.type === "dir" ? `${e.name}/` : e.name)) : [];
  },
  async listRepos(i) {
    const j = await call<{ repositories: { name: string; default_branch: string; owner: { login: string } }[] }>(i, "GET", `/installation/repositories?per_page=100`);
    return (j?.repositories || []).map((r) => ({ owner: r.owner.login, name: r.name, defaultBranch: r.default_branch }));
  },
  async closePr(i, owner, repo, n) {
    await call(i, "PATCH", `/repos/${owner}/${repo}/pulls/${n}`, { state: "closed" });
  },
};

// GitHub user OAuth (the app's "user authorization"): exchange the code and list
// the installations this GitHub user can see. Used to claim installations, so
// nobody can attach an installation id that is not theirs.
export async function userInstallations(code: string): Promise<{ id: number; account: string | null }[] | null> {
  const id = process.env.GITHUB_APP_CLIENT_ID;
  const secret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!id || !secret) return null;
  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, client_secret: secret, code }),
  });
  const tok = (await tokRes.json().catch(() => null)) as { access_token?: string } | null;
  if (!tok?.access_token) return null;
  const { res, json } = await raw(tok.access_token, "GET", "/user/installations?per_page=100");
  if (!res.ok) return null;
  const list = (json as { installations?: { id: number; account?: { login?: string } }[] }).installations || [];
  return list.map((x) => ({ id: x.id, account: x.account?.login ?? null }));
}

export async function userCanSeeInstallation(code: string, installationId: number): Promise<boolean> {
  const list = await userInstallations(code);
  return !!list && list.some((x) => x.id === installationId);
}

// Where the owner of an installation changes which repos the app can see.
export async function installationConfigureUrl(installationId: number): Promise<string> {
  const fallback = `https://github.com/settings/installations/${installationId}`;
  try {
    const jwt = appJwt(process.env.GITHUB_APP_ID || "", privateKey());
    const { res, json } = await raw(jwt, "GET", `/app/installations/${installationId}`);
    if (!res.ok) return fallback;
    const j = json as { html_url?: string };
    return j.html_url || fallback;
  } catch {
    return fallback;
  }
}

// Does this installation have "Secrets: write" yet? (An installation keeps its old
// permissions until its owner approves the new ones.) App-level request: it does
// not use the installation's rate limit.
export type SecretsAccess = "write" | "read" | "none" | "error";

// What GitHub says this installation may do with Actions secrets, so the setup page can
// say exactly what is missing instead of guessing.
export async function installationSecretsAccess(installationId: number): Promise<SecretsAccess> {
  try {
    const jwt = appJwt(process.env.GITHUB_APP_ID || "", privateKey());
    const { res, json } = await raw(jwt, "GET", `/app/installations/${installationId}`);
    if (!res.ok) return "error";
    const p = (json as { permissions?: Record<string, string> }).permissions?.secrets;
    return p === "write" ? "write" : p === "read" ? "read" : "none";
  } catch {
    return "error";
  }
}

export async function installationCanWriteSecrets(installationId: number): Promise<boolean> {
  return (await installationSecretsAccess(installationId)) === "write";
}
