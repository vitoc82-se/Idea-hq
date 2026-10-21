import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// An installation of the GitHub App on an organisation covers every repo the app was given, including ones a given
// member cannot open. Idea HQ acts with the app's rights, so it must first know the PERSON may use the repo.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, claim: [] as { id: number; account: string | null; repos?: string[] | null }[] }));
const gh = vi.hoisted(() => ({ repos: [] as { owner: string; name: string; defaultBranch: string }[] }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
vi.mock("@/lib/github/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/client")>()),
  userInstallations: async () => sess.claim,
  installationConfigureUrl: async () => "https://github.com/settings/installations/1",
  installationSecretsAccess: async () => "write",
  github: { listRepos: async () => gh.repos, repoBranch: async () => ({ sha: "abc" }), getFile: async () => null, secretExists: async () => false, listTree: async () => ({ paths: [], truncated: false }) },
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { repoAccessFrom, repoAccess, requireRepoAccess, repoAccessProblem, RepoAccessError } from "@/lib/github/access";
import { GET as getRepo, PUT as putRepo } from "@/app/api/projects/[id]/repo/route";
import { GET as callback } from "@/app/api/github/callback/route";
import { GET as relayCapability } from "@/app/api/projects/[id]/relay-capability/route";
import { GET as importList } from "@/app/api/projects/[id]/import/route";
import { POST as contextDraft } from "@/app/api/projects/[id]/context-draft/route";
import { relayProviderKey } from "@/lib/provider-keys";
import { signState } from "@/lib/runs/http";
import * as client from "@/lib/github/client";
import { Prisma } from "@/generated/prisma/client";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const ALL = [
  { owner: "acme", name: "web", defaultBranch: "main" },
  { owner: "acme", name: "payroll", defaultBranch: "main" },
];

async function member(id: string, repos: string[] | null) {
  await db.user.create({ data: { id, email: `${id}@x.se`, approved: true } });
  await db.githubInstallation.create({ data: { userId: id, id: 7, repos: repos ?? Prisma.DbNull } });
  await db.project.create({ data: { id: `p-${id}`, userId: id, name: id, slug: id, context: "" } });
}
const link = (repo: string) =>
  putRepo(new Request("https://x", { method: "PUT", body: JSON.stringify({ installationId: 7, repoOwner: "acme", repoName: repo, envBranches: { prod: "main" } }) }), { params: Promise.resolve({ id: "p-ann" }) });

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "owner@x.se";
  gh.repos = ALL;
  sess.claim = [];
  sess.user = { id: "ann", email: "ann@x.se" };
});

describe("who may use which repo", () => {
  it("reads the list GitHub gave, in any letters", () => {
    expect(repoAccessFrom(["acme/web"], "Acme", "WEB")).toBe("yes");
    expect(repoAccessFrom(["acme/web"], "acme", "payroll")).toBe("no");
    expect(repoAccessFrom([], "acme", "web")).toBe("no");
    for (const unknown of [null, undefined, "acme/web", { a: 1 }]) expect(repoAccessFrom(unknown, "acme", "web"), String(unknown)).toBe("unknown");
  });
  it("is per person: the same installation, two members, different repos", async () => {
    await member("ann", ["acme/web"]);
    await db.user.create({ data: { id: "bob", email: "bob@x.se", approved: true } });
    await db.githubInstallation.create({ data: { userId: "bob", id: 7, repos: ["acme/web", "acme/payroll"] } });
    expect(await repoAccess("ann", 7, "acme", "payroll")).toBe("no");
    expect(await repoAccess("bob", 7, "acme", "payroll")).toBe("yes");
  });
  it("requireRepoAccess refuses 'no', allows 'yes', 'unknown', no connection row and no repo", async () => {
    await member("ann", ["acme/web"]);
    const p = (over = {}) => ({ userId: "ann", installationId: 7, repoOwner: "acme", repoName: "web", ...over });
    await expect(requireRepoAccess(p({ repoName: "payroll" }))).rejects.toBeInstanceOf(RepoAccessError);
    await expect(requireRepoAccess(p())).resolves.toBeUndefined();
    await expect(requireRepoAccess(p({ installationId: 99 }))).resolves.toBeUndefined(); // no row: nothing to compare with
    await expect(requireRepoAccess(p({ installationId: null }))).resolves.toBeUndefined();
    expect(await repoAccessProblem(p({ repoName: "payroll" }))).toMatch(/do not have access to acme\/payroll/);
    expect(await repoAccessProblem(p())).toBeNull();
  });
});

describe("connecting GitHub stores what the person can open", () => {
  const cb = () => callback(new Request(`https://x/api/github/callback?code=c&state=${signState("ann")}`));
  beforeEach(async () => { await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true } }); });
  it("saves the list, and a reconnect refreshes it", async () => {
    sess.claim = [{ id: 7, account: "acme", repos: ["acme/web"] }];
    await cb();
    expect((await db.githubInstallation.findFirst({ where: { userId: "ann", id: 7 } }))?.repos).toEqual(["acme/web"]);
    sess.claim = [{ id: 7, account: "acme", repos: ["acme/web", "acme/payroll"] }];
    await cb();
    const row = (await db.githubInstallation.findFirst({ where: { userId: "ann", id: 7 } }))!;
    expect(row.repos).toEqual(["acme/web", "acme/payroll"]);
    expect(row.reposCheckedAt).toBeInstanceOf(Date);
  });
  it("when GitHub does not say, an existing list is kept, not erased", async () => {
    await db.githubInstallation.create({ data: { userId: "ann", id: 7, repos: ["acme/web"] } });
    sess.claim = [{ id: 7, account: "acme", repos: null }];
    await cb();
    expect((await db.githubInstallation.findFirst({ where: { userId: "ann", id: 7 } }))?.repos).toEqual(["acme/web"]);
  });
});

describe("the real GitHub lookup", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });
  it("asks GitHub which repos THIS person can reach in each installation, with their own token", async () => {
    process.env.GITHUB_APP_CLIENT_ID = "id"; process.env.GITHUB_APP_CLIENT_SECRET = "secret";
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      seen.push(`${(init?.headers as Record<string, string>)?.Authorization ?? ""} ${u}`);
      if (u.includes("login/oauth/access_token")) return new Response(JSON.stringify({ access_token: "USER-TOKEN" }));
      if (u.includes("/user/installations?")) return new Response(JSON.stringify({ installations: [{ id: 7, account: { login: "acme" } }, { id: 8, account: { login: "me" } }] }));
      if (u.includes("/user/installations/7/repositories")) return new Response(JSON.stringify({ repositories: [{ full_name: "Acme/Web" }] }));
      return new Response("{}", { status: 403 }); // installation 8: GitHub would not say
    }) as unknown as typeof fetch;
    const real = await vi.importActual<typeof import("@/lib/github/client")>("@/lib/github/client");
    const out = await real.userInstallations("code");
    expect(out).toEqual([{ id: 7, account: "acme", repos: ["acme/web"] }, { id: 8, account: "me", repos: null }]);
    expect(seen.filter((s) => s.includes("/repositories")).every((s) => s.startsWith("Bearer USER-TOKEN"))).toBe(true);
  });
});

describe("linking a repository", () => {
  beforeEach(async () => { await member("ann", ["acme/web"]); });
  it("a repo of theirs can be linked, one they cannot open cannot", async () => {
    const no = await link("payroll");
    expect(no.status).toBe(403);
    expect((await db.project.findUnique({ where: { id: "p-ann" } }))?.repoName).toBeNull();
    expect((await link("web")).status).toBe(200);
    expect((await db.project.findUnique({ where: { id: "p-ann" } }))?.repoName).toBe("web");
  });
  it("saving settings for the repo already linked does not ask again", async () => {
    await link("web");
    await db.githubInstallation.update({ where: { userId_id: { userId: "ann", id: 7 } }, data: { repos: ["acme/other"] } });
    expect((await link("web")).status).toBe(200);
  });
  it("a connection from before the check must reconnect to link a NEW repo", async () => {
    await db.githubInstallation.update({ where: { userId_id: { userId: "ann", id: 7 } }, data: { repos: Prisma.DbNull } });
    const res = await link("web");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Reconnect GitHub/);
  });
  it("the picker lists only the repos they can open, and says when the list is unknown", async () => {
    const get = async () => (await (await getRepo(new Request("https://x"), { params: Promise.resolve({ id: "p-ann" }) })).json());
    expect((await get()).available[0].repos.map((r: { name: string }) => r.name)).toEqual(["web"]);
    expect((await get()).available[0].needsReconnect).toBe(false);
    await db.githubInstallation.update({ where: { userId_id: { userId: "ann", id: 7 } }, data: { repos: Prisma.DbNull } });
    const unknown = await get();
    expect(unknown.available[0].repos).toHaveLength(2);
    expect(unknown.available[0].needsReconnect).toBe(true);
  });
  it("a linked project whose repo the person lost shows it, and the repo is not contacted", async () => {
    await db.project.update({ where: { id: "p-ann" }, data: { installationId: 7, repoOwner: "acme", repoName: "payroll", envBranches: { prod: "main" }, defaultEnv: "prod" } });
    const res = await (await getRepo(new Request("https://x"), { params: Promise.resolve({ id: "p-ann" }) })).json();
    expect(res.project.repoAccess).toBe("no");
  });
});

describe("what a project does with a repo the person cannot open", () => {
  beforeEach(async () => {
    await member("ann", ["acme/web"]);
    await db.project.update({ where: { id: "p-ann" }, data: { installationId: 7, repoOwner: "acme", repoName: "payroll", envBranches: { prod: "main" }, defaultEnv: "prod" } });
  });
  const pid = { params: Promise.resolve({ id: "p-ann" }) };
  it("API routes answer 403 with a plain sentence", async () => {
    for (const res of [
      await relayCapability(new Request("https://x"), pid),
      await importList(new Request("https://x"), pid),
      await contextDraft(new Request("https://x", { method: "POST", body: "{}" }), pid),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/do not have access to acme\/payroll/);
    }
  });
  it("a pasted API key is not written into that repo's secrets", async () => {
    const put = vi.fn();
    await expect(
      relayProviderKey("ann", "p-ann", { provider: "claude", key: "sk-ant-" + "x".repeat(40) }, { gh: { putSecret: put, getSecretsPublicKey: vi.fn() } as never, fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch })
    ).rejects.toThrow(/do not have access/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("tokens are limited to one repository", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  it("asks GitHub for a token that only works for the repo in the request", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const mint: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/access_tokens")) {
        mint.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(JSON.stringify({ token: "T", expires_at: new Date(Date.now() + 3_600_000).toISOString() }), { status: 201 });
      }
      return new Response(JSON.stringify({ commit: { sha: "s" }, protected: false }));
    }) as unknown as typeof fetch;
    const real = await vi.importActual<typeof import("@/lib/github/client")>("@/lib/github/client");
    await real.github.repoBranch(555, "acme", "web", "main");
    await real.github.repoBranch(555, "acme", "web", "dev"); // cached
    await real.github.repoBranch(555, "acme", "payroll", "main");
    expect(mint.map((m) => m.body)).toEqual([{ repositories: ["web"] }, { repositories: ["payroll"] }]);
    expect(real.repoFromPath("/repos/acme/web/git/trees/main?recursive=1")).toBe("web");
    expect(real.repoFromPath("/installation/repositories")).toBeUndefined();
    expect(client.installationToken).toBeTypeOf("function");
  });
});

// A new place that talks to a project's repository must ask first. Fails when a file uses a project's installation
// without importing the access check (or is on the short list of files that are checked elsewhere).
describe("every use of a project's repository is guarded", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(f)) files.push(full);
    }
  };
  walk("src");
  const skip = [/^src\/generated\//, /^src\/lib\/github\/(client|access)\.ts$/, /^src\/lib\/runs\/(engine|setup)\.ts$/, /\.tsx$/, /^src\/app\/api\/github\//, /^src\/lib\/runs\/http\.ts$/];
  it("files that use p.installationId import the access check", () => {
    const missing = files
      .filter((f) => !skip.some((re) => re.test(f)))
      .filter((f) => /\.installationId\b/.test(readFileSync(f, "utf8")))
      .filter((f) => !/github\/access"/.test(readFileSync(f, "utf8")));
    expect(missing).toEqual([]);
  });
  it("the engine and the setup status import it too", () => {
    for (const f of ["src/lib/runs/engine.ts", "src/lib/runs/setup.ts"]) expect(readFileSync(f, "utf8"), f).toMatch(/github\/access"/);
  });
});
