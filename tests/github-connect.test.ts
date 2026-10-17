import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbProxy, calls, sessionRef, FRIEND } from "./helpers";

const gh = vi.hoisted(() => ({ list: null as null | { id: number; account: string | null }[] }));
vi.mock("@/lib/db", () => ({ db: makeDbProxy() }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sessionRef.user ? { user: sessionRef.user } : null),
  getCurrentUserId: async () => sessionRef.user?.id ?? null,
}));
vi.mock("next-auth", () => ({ getServerSession: async () => (sessionRef.user ? { user: sessionRef.user } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/github/client", async (orig) => ({ ...(await orig<typeof import("@/lib/github/client")>()), userInstallations: async () => gh.list }));

import { GET as install } from "@/app/api/github/install/route";
import { GET as callback } from "@/app/api/github/callback/route";
import { signState } from "@/lib/runs/http";

const req = (path: string, cookie = "") => new Request(`https://app.test${path}`, { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  calls.length = 0; gh.list = null;
  sessionRef.user = { id: FRIEND.id, email: FRIEND.email };
  process.env.OWNER_EMAIL = "owner@x.se";
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.GITHUB_APP_SLUG = "idea-hq-niklas";
  process.env.GITHUB_APP_CLIENT_ID = "Iv-test";
});

describe("install (connect GitHub)", () => {
  it("defaults to GitHub sign-in, which works even if the app is already installed", async () => {
    const res = await install(req("/api/github/install?next=/welcome"));
    expect(res.headers.get("location")).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?client_id=Iv-test&state=/);
    expect(res.headers.get("set-cookie")).toContain("ihq_next=%2Fwelcome");
  });
  it("?fresh=1 goes to a new install (another account or org)", async () => {
    const res = await install(req("/api/github/install?fresh=1"));
    expect(res.headers.get("location")).toContain("github.com/apps/idea-hq-niklas/installations/new");
  });
  it("only remembers our own return paths", async () => {
    const res = await install(req("/api/github/install?next=https://evil.example/x"));
    expect(res.headers.get("set-cookie") || "").not.toContain("ihq_next");
  });
});

describe("callback", () => {
  const cb = (q: string, cookie = "") => callback(req(`/api/github/callback?${q}`, cookie));
  const loc = (r: Response) => r.headers.get("location") || "";

  it("rejects a bad or foreign state", async () => {
    const r = await cb("code=c&state=nope");
    expect(loc(r)).toContain("github=bad_state");
    expect(calls.filter((c) => c.model === "githubInstallation")).toHaveLength(0);
  });

  it("OAuth sign-in claims every installation the person can see and returns to /welcome", async () => {
    gh.list = [{ id: 5, account: "me" }, { id: 9, account: "org" }];
    const r = await cb(`code=c&state=${signState(FRIEND.id)}`, "ihq_next=%2Fwelcome");
    expect(loc(r)).toBe("https://app.test/welcome?github=connected");
    const ups = calls.filter((c) => c.model === "githubInstallation" && c.method === "upsert");
    expect(ups.map((u) => (u.args[0] as { create: { id: number; userId: string } }).create)).toEqual([
      { userId: FRIEND.id, id: 5 }, { userId: FRIEND.id, id: 9 },
    ]);
  });

  it("refuses an installation id the person cannot see", async () => {
    gh.list = [{ id: 5, account: "me" }];
    const r = await cb(`code=c&installation_id=777&state=${signState(FRIEND.id)}`);
    expect(loc(r)).toContain("github=not_yours");
    expect(calls.filter((c) => c.model === "githubInstallation")).toHaveLength(0);
  });

  it("a fresh install claims just that installation", async () => {
    gh.list = [{ id: 5, account: "me" }, { id: 9, account: "org" }];
    const r = await cb(`code=c&installation_id=9&state=${signState(FRIEND.id)}`);
    expect(loc(r)).toContain("github=connected");
    const ups = calls.filter((c) => c.method === "upsert");
    expect(ups).toHaveLength(1);
  });

  it("signed in but nothing installed yet: sends them to install the app", async () => {
    gh.list = [];
    const r = await cb(`code=c&state=${signState(FRIEND.id)}`);
    expect(loc(r)).toContain("github.com/apps/idea-hq-niklas/installations/new");
  });

  it("a failed GitHub exchange comes back with an error, not a crash", async () => {
    gh.list = null;
    const r = await cb(`code=c&state=${signState(FRIEND.id)}`);
    expect(loc(r)).toContain("github=failed");
  });

  it("ignores a return cookie that is not one of our paths", async () => {
    gh.list = [{ id: 5, account: "me" }];
    const r = await cb(`code=c&state=${signState(FRIEND.id)}`, "ihq_next=https%3A%2F%2Fevil.example");
    expect(loc(r).startsWith("https://app.test/projects?github=")).toBe(true);
  });
});
