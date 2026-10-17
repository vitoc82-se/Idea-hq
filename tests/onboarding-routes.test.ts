import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDbProxy, calls, sessionRef, UNAPPROVED, FRIEND } from "./helpers";

vi.mock("@/lib/db", () => ({ db: makeDbProxy() }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sessionRef.user ? { user: sessionRef.user } : null),
  getCurrentUserId: async () => sessionRef.user?.id ?? null,
}));
vi.mock("next-auth", () => ({ getServerSession: async () => (sessionRef.user ? { user: sessionRef.user } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/onboarding/route";
import { POST as DISMISS } from "@/app/api/onboarding/dismiss/route";

beforeEach(() => { calls.length = 0; sessionRef.user = null; process.env.OWNER_EMAIL = "owner@x.se"; });

describe("onboarding routes", () => {
  it("require a session", async () => {
    expect((await GET()).status).toBe(401);
    expect((await DISMISS()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("let an UNAPPROVED user read their own journey (they must be able to see 'waiting for approval')", async () => {
    sessionRef.user = { id: UNAPPROVED.id, email: UNAPPROVED.email };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approved).toBe(false);
    expect(body.currentId).toBe("approval");
  });

  it("only read this user's rows", async () => {
    sessionRef.user = { id: FRIEND.id, email: FRIEND.email };
    await GET();
    for (const c of calls.filter((c) => ["project", "idea", "run"].includes(c.model))) {
      const where = (c.args[0] as { where?: { userId?: string } })?.where;
      expect(where?.userId, `${c.model}.${c.method}`).toBe(FRIEND.id);
    }
  });

  it("dismiss only updates the caller", async () => {
    sessionRef.user = { id: FRIEND.id, email: FRIEND.email };
    expect((await DISMISS()).status).toBe(200);
    const upd = calls.find((c) => c.model === "user" && c.method === "update")!;
    expect((upd.args[0] as { where: { id: string } }).where.id).toBe(FRIEND.id);
  });
});
