import { db } from "./db";

// A session (the signed cookie) carries the "session version" the person had when they signed in. Raising the
// number on the account makes every older session invalid at once: after a password change, and for
// "sign out on all devices". Without this a stolen cookie keeps working for 30 days whatever the password.
export const SESSION_REVOKED = "SessionRevoked";

export async function revokeAllSessions(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

// Throws SESSION_REVOKED when the account is gone or the session is older than the account's current version.
export async function assertSessionCurrent(userId: unknown, version: unknown): Promise<void> {
  if (typeof userId !== "string") throw new Error(SESSION_REVOKED);
  const row = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  // Sessions made before this existed carry no number: they count as version 0, the starting value.
  if (!row || row.sessionVersion !== (typeof version === "number" ? version : 0)) throw new Error(SESSION_REVOKED);
}
