import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";

// A session is a signed cookie that works for 30 days. It must stop working when the password changes or when
// the person signs out everywhere, otherwise a stolen cookie outlives every password change.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
vi.mock("next-auth", async (orig) => ({ ...(await orig<typeof import("next-auth")>()), getServerSession: async () => (sess.user ? { user: sess.user } : null) }));
const SECRET = "test-secret-test-secret-test-secret";
process.env.NEXTAUTH_SECRET = SECRET;
process.env.SUPPORT_TURNSTILE_BYPASS = "1";

import { db, resetDb } from "./pg";
import { authOptions } from "@/lib/auth";
import { revokeAllSessions, SESSION_REVOKED } from "@/lib/sessions";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { POST as revoke } from "@/app/api/auth/revoke-sessions/route";
import { AUTH_RULES } from "@/lib/auth-limits";
import { rateStore } from "@/lib/support/public-store";
import { getServerSession } from "next-auth/next";

const cb = authOptions.callbacks as unknown as {
  jwt: (a: { token: Record<string, unknown>; user?: { id: string } }) => Promise<Record<string, unknown>>;
  session: (a: { session: { user: { id?: string } }; token: Record<string, unknown> }) => Promise<unknown>;
};
const version = async (id = "ann") => (await db.user.findUnique({ where: { id } }))!.sessionVersion;
const post = (body: unknown, ip = "9.9.9.9") =>
  changePassword(new Request("https://x/api/auth/change-password", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify(body) }));

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "ann@x.se";
  sess.user = { id: "ann", email: "ann@x.se" };
  await db.user.create({ data: { id: "ann", email: "ann@x.se", approved: true, password: await bcrypt.hash("old-password", 4) } });
});
afterEach(() => vi.restoreAllMocks());

describe("session version", () => {
  it("a new session carries the account's version and is accepted", async () => {
    const token = await cb.jwt({ token: {}, user: { id: "ann" } });
    expect(token).toMatchObject({ id: "ann", sv: 0 });
    await expect(cb.session({ session: { user: {} }, token })).resolves.toBeTruthy();
  });
  it("is refused after the account's sessions are revoked, and a new sign-in works again", async () => {
    const old = await cb.jwt({ token: {}, user: { id: "ann" } });
    await revokeAllSessions("ann");
    expect(await version()).toBe(1);
    await expect(cb.session({ session: { user: {} }, token: old })).rejects.toThrow(SESSION_REVOKED);
    const fresh = await cb.jwt({ token: {}, user: { id: "ann" } });
    expect(fresh.sv).toBe(1);
    await expect(cb.session({ session: { user: {} }, token: fresh })).resolves.toBeTruthy();
  });
  it("sessions made before this existed (no number) keep working until the first revoke", async () => {
    await expect(cb.session({ session: { user: {} }, token: { id: "ann" } })).resolves.toBeTruthy();
    await revokeAllSessions("ann");
    await expect(cb.session({ session: { user: {} }, token: { id: "ann" } })).rejects.toThrow(SESSION_REVOKED);
  });
  it("a deleted account, or a token without an id, is refused", async () => {
    await expect(cb.session({ session: { user: {} }, token: { id: "gone", sv: 0 } })).rejects.toThrow(SESSION_REVOKED);
    await expect(cb.session({ session: { user: {} }, token: {} })).rejects.toThrow(SESSION_REVOKED);
  });
  it("end to end: a signed cookie stops giving a session after the revoke", async () => {
    const cookie = async (sv: number) => encode({ token: { id: "ann", sv }, secret: SECRET });
    const read = async (sv: number) => {
      const req = { headers: {}, cookies: { "next-auth.session-token": await cookie(sv) } };
      const res = { getHeader() {}, setCookie() {}, setHeader() {} };
      return (await getServerSession(req as never, res as never, authOptions)) as { user?: { id?: string } } | null;
    };
    expect((await read(0))?.user?.id).toBe("ann");
    await revokeAllSessions("ann");
    expect(await read(0)).toBeNull();
    expect((await read(1))?.user?.id).toBe("ann");
  });
  it("a revoked session is not logged as an error; other errors are logged by name only", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    authOptions.logger!.error!("JWT_SESSION_ERROR", { message: SESSION_REVOKED, name: "Error" } as never);
    expect(log).not.toHaveBeenCalled();
    authOptions.logger!.error!("OAUTH_CALLBACK_ERROR", { message: "secret detail user@x.se" } as never);
    expect(log).toHaveBeenCalledWith("auth error:", "OAUTH_CALLBACK_ERROR");
  });
});

describe("changing the password", () => {
  it("needs a signed-in person", async () => {
    sess.user = null;
    expect((await post({ currentPassword: "old-password", newPassword: "new-password" })).status).toBe(401);
  });
  it("signs out every session, and only after a correct current password", async () => {
    const wrong = await post({ currentPassword: "nope-nope", newPassword: "new-password" });
    expect(wrong.status).toBe(403);
    expect(await version()).toBe(0);
    const ok = await post({ currentPassword: "old-password", newPassword: "new-password" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ signedOut: true });
    expect(await version()).toBe(1);
    expect(await bcrypt.compare("new-password", (await db.user.findUnique({ where: { id: "ann" } }))!.password!)).toBe(true);
    // a session from before the change no longer works
    await expect(cb.session({ session: { user: {} }, token: { id: "ann", sv: 0 } })).rejects.toThrow(SESSION_REVOKED);
  });
  it("checks the input", async () => {
    const cases: [unknown, number][] = [
      [null, 400], [{}, 400], [{ currentPassword: 1, newPassword: "new-password" }, 400], [{ currentPassword: "old-password", newPassword: { a: 1 } }, 400],
      [{ currentPassword: "old-password", newPassword: "short" }, 400], [{ currentPassword: "old-password", newPassword: "x".repeat(73) }, 400],
      [{ currentPassword: "old-password", newPassword: "é".repeat(40) }, 400], [{ currentPassword: "old-password", newPassword: "old-password" }, 400],
      [{ currentPassword: "x".repeat(5000), newPassword: "new-password" }, 403],
    ];
    for (const [body, status] of cases) {
      await db.rateBucket.deleteMany({}); // (every attempt counts toward the limit, tested below)
      expect((await post(body)).status, JSON.stringify(body)?.slice(0, 60)).toBe(status);
    }
    expect(await version()).toBe(0);
  });
  it("limits guessing of the current password, per person and per place", async () => {
    for (let i = 0; i < 8; i++) expect((await post({ currentPassword: `guess-${i}-xx`, newPassword: "new-password" }, `5.5.5.${i}`)).status).toBe(403);
    const blocked = await post({ currentPassword: "old-password", newPassword: "new-password" }, "5.5.5.99");
    expect(blocked.status).toBe(429);
    expect(await version()).toBe(0);
  });
  it("a flood from one place is stopped for everyone behind it", async () => {
    for (let i = 0; i < AUTH_RULES.changePasswordIp("7.7.7.7").limit; i++) await rateStore.hit(AUTH_RULES.changePasswordIp("7.7.7.7").key, 900);
    expect((await post({ currentPassword: "old-password", newPassword: "new-password" }, "7.7.7.7")).status).toBe(429);
  });
});

describe("sign out on all devices", () => {
  it("needs a signed-in person", async () => {
    sess.user = null;
    expect((await revoke()).status).toBe(401);
    expect(await version()).toBe(0);
  });
  it("revokes every session of that person only", async () => {
    await db.user.create({ data: { id: "bea", email: "bea@x.se", approved: true } });
    expect((await revoke()).status).toBe(200);
    expect(await version("ann")).toBe(1);
    expect(await version("bea")).toBe(0);
  });
});
