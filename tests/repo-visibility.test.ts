import { describe, it, expect, vi, beforeEach } from "vitest";

// The project remembers whether its GitHub repo is public (the owner is warned, and customer details are kept
// out of what goes into a public repo).
const gh = vi.hoisted(() => ({
  repos: [] as { owner: string; name: string; defaultBranch: string; isPrivate?: boolean }[],
}));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "u1", email: "ann@x.se" } }), getCurrentUserId: async () => "u1" }));
vi.mock("@/lib/github/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/client")>()),
  installationConfigureUrl: async () => "https://github.com/settings/installations/1",
  github: {
    listRepos: async () => gh.repos,
    repoBranch: async () => ({ sha: "abc" }),
    getFile: async () => null,
    secretExists: async () => false,
  },
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { GET, PUT } from "@/app/api/projects/[id]/repo/route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const put = (repo: string) =>
  PUT(new Request("https://x", { method: "PUT", body: JSON.stringify({ installationId: 1, repoOwner: "acme", repoName: repo, envBranches: { prod: "main" } }) }), ctx);
const get = async () => (await (await GET(new Request("https://x"), ctx)).json()).project;

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "ann@x.se";
  await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
  await db.githubInstallation.create({ data: { id: 1, userId: "u1", accountLogin: "acme", repos: ["acme/open", "acme/secret", "acme/mystery"] } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
  gh.repos = [
    { owner: "acme", name: "open", defaultBranch: "main", isPrivate: false },
    { owner: "acme", name: "secret", defaultBranch: "main", isPrivate: true },
    { owner: "acme", name: "mystery", defaultBranch: "main" },
  ];
});

describe("repo visibility", () => {
  it("is stored when a repo is linked, and reported as public only when GitHub said so", async () => {
    expect((await put("open")).status).toBe(200);
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.repoPrivate).toBe(false);
    expect((await get()).repoPublic).toBe(true);
    await put("secret");
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.repoPrivate).toBe(true);
    expect((await get()).repoPublic).toBe(false);
  });
  it("is unknown when GitHub does not say, and no public warning is claimed", async () => {
    await put("mystery");
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.repoPrivate).toBeNull();
    expect((await get()).repoPublic).toBe(false);
  });
  it("follows the repo when it is made private or public later", async () => {
    await put("open");
    gh.repos[0].isPrivate = true;
    expect((await get()).repoPublic).toBe(false);
    expect((await db.project.findUnique({ where: { id: "p1" } }))?.repoPrivate).toBe(true);
    gh.repos[0].isPrivate = false;
    expect((await get()).repoPublic).toBe(true);
  });
});
