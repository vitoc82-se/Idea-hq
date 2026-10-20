import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Why the "paste your API key here" box is or is not shown on the setup page.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { GET } from "@/app/api/projects/[id]/relay-capability/route";
import { installationSecretsAccess } from "@/lib/github/client";

const realFetch = globalThis.fetch;
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

function githubSays(status: number, permissions: Record<string, string> | null) {
  globalThis.fetch = (async () => new Response(JSON.stringify(permissions ? { permissions } : {}), { status })) as unknown as typeof fetch;
}
const ask = async (id = "p1") => (await GET(new Request("https://x"), { params: { id } })).json();

beforeEach(async () => {
  await resetDb();
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.OWNER_EMAIL = "boss@x.se";
  sess.user = { id: "u1", email: "ann@x.se" };
  await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "", installationId: 99, repoOwner: "ann", repoName: "shop" } });
  await db.project.create({ data: { id: "p2", userId: "u1", name: "NoRepo", slug: "norepo", context: "" } });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("installationSecretsAccess", () => {
  it("reads write, read, none and failures from GitHub", async () => {
    githubSays(200, { secrets: "write" });
    expect(await installationSecretsAccess(99)).toBe("write");
    githubSays(200, { secrets: "read", contents: "write" });
    expect(await installationSecretsAccess(99)).toBe("read");
    githubSays(200, { contents: "write" });
    expect(await installationSecretsAccess(99)).toBe("none");
    githubSays(401, null);
    expect(await installationSecretsAccess(99)).toBe("error");
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await installationSecretsAccess(99)).toBe("error");
  });
});

describe("GET /api/projects/[id]/relay-capability", () => {
  it("says it can save the key when the installation may write secrets", async () => {
    githubSays(200, { secrets: "write" });
    expect(await ask()).toEqual({ canWrite: true, reason: null });
  });
  it("says the installation needs approval when it can only read secrets", async () => {
    githubSays(200, { secrets: "read" });
    expect(await ask()).toEqual({ canWrite: false, reason: "permission" });
  });
  it("says to connect the repo first when the project has none, without asking GitHub", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await ask("p2")).toEqual({ canWrite: false, reason: "no_repo" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("says the check failed (not a missing permission) when GitHub cannot be reached", async () => {
    githubSays(500, null);
    expect(await ask()).toEqual({ canWrite: false, reason: "check_failed" });
  });
  it("only for the person's own project", async () => {
    await db.user.create({ data: { id: "u2", email: "bob@x.se", approved: true } });
    sess.user = { id: "u2", email: "bob@x.se" };
    expect((await GET(new Request("https://x"), { params: { id: "p1" } })).status).toBe(404);
  });
});
