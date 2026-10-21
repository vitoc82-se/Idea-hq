import bcrypt from "bcryptjs";
import { db } from "./db";
import { isOwner } from "./owner";
import { isPro } from "./billing";
import { normalizeEmail } from "./support/sanitize";

// A person's right to take their data with them and to have it removed (also needed before offering Idea HQ to people
// who are not friends). Works for anyone with an account, approved or not.

const EXPORT_ROWS = 5000; // per kind of data: far more than anyone has, but never unbounded

export async function accountSummary(userId: string, email: string | null | undefined) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, password: true, subStatus: true, subEndsAt: true, proRevokedAt: true } });
  if (!u) return null;
  return { email: u.email, hasPassword: !!u.password, blocked: await deleteBlock(userId, email, u) };
}

type BillingFields = { subStatus: string | null; subEndsAt: Date | null; proRevokedAt: Date | null };

// A reason this account cannot be deleted right now, or null.
async function deleteBlock(userId: string, email: string | null | undefined, u: BillingFields): Promise<string | null> {
  if (await isOwner(userId, email)) return "This is the owner account. It cannot be deleted here, because it runs this Idea HQ.";
  // A subscription that is still billing must be stopped first, or the person would keep paying for an account that is gone.
  if (["active", "on_trial", "past_due"].includes(u.subStatus ?? "") && isPro({ ...u }, new Date())) {
    return "Your Pro subscription is still running. Cancel it first (Billing, Manage subscription), then delete the account, so you are not charged again.";
  }
  return null;
}

export type DeleteResult = { ok: true } | { ok: false; status: number; error: string };

export async function deleteAccount(userId: string, email: string | null | undefined, input: { confirm: unknown; password: unknown }): Promise<DeleteResult> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, password: true, subStatus: true, subEndsAt: true, proRevokedAt: true } });
  if (!u) return { ok: false, status: 404, error: "This account does not exist any more." };
  const blocked = await deleteBlock(userId, email, u);
  if (blocked) return { ok: false, status: 409, error: blocked };

  // Typing the address is the "are you sure". A person with a password also proves it is them (a stolen session alone is not enough).
  const typed = typeof input.confirm === "string" ? input.confirm : "";
  const wanted = u.email ? normalizeEmail(u.email) : null;
  if (wanted ? normalizeEmail(typed) !== wanted : typed.trim().toLowerCase() !== "delete") {
    return { ok: false, status: 400, error: wanted ? "Type your email address exactly to confirm." : "Type DELETE to confirm." };
  }
  if (u.password) {
    const pw = typeof input.password === "string" ? input.password : "";
    if (!pw || pw.length > 200 || !(await bcrypt.compare(pw, u.password))) return { ok: false, status: 403, error: "That password is not right." };
  }

  // Everything the person owns goes with the account (projects, ideas, runs, memory, support spaces and their tickets,
  // what's-new entries, GitHub connections, sign-in links). Every session of theirs stops working with the row.
  await db.billingEvent.updateMany({ where: { userId }, data: { userId: null } }); // keep the payment ids (they stop double-granting), drop the link to the person
  await db.user.delete({ where: { id: userId } });
  return { ok: true };
}

// Everything held about the person, as one JSON document. No password hash, no tokens or keys.
export async function exportAccount(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, emailVerified: true, image: true, approved: true, features: true, createdAt: true, updatedAt: true,
      notifyEmail: true, aiBuild: true, aiDailyLimit: true, freeAccess: true, aiCredits: true, subStatus: true, subEndsAt: true,
    },
  });
  if (!user) return null;
  const take = EXPORT_ROWS;
  const [signInMethods, installations, projects, ideas, runs, memory, spaces, tickets, changelog] = await Promise.all([
    db.account.findMany({ where: { userId }, select: { provider: true, type: true } }),
    db.githubInstallation.findMany({ where: { userId }, select: { id: true, accountLogin: true, repos: true, createdAt: true } }),
    db.project.findMany({ where: { userId }, take, orderBy: { createdAt: "asc" } }),
    db.idea.findMany({ where: { userId }, take, orderBy: { createdAt: "asc" } }),
    db.run.findMany({ where: { userId }, take, orderBy: { createdAt: "asc" } }),
    db.projectMemory.findMany({ where: { userId }, take, orderBy: { createdAt: "asc" } }),
    db.supportSpace.findMany({ where: { project: { userId } }, take }),
    db.ticket.findMany({ where: { project: { userId } }, take, orderBy: { createdAt: "asc" }, include: { messages: { orderBy: { createdAt: "asc" } } } }),
    db.changelogEntry.findMany({ where: { project: { userId } }, take, orderBy: { createdAt: "asc" } }),
  ]);
  // Tickets are stored with a hash of the customer's private link, never the link itself; that hash is not personal data worth sharing.
  const cleanTickets = tickets.map((t) => {
    const { tokenHash, ...rest } = t;
    void tokenHash;
    return rest;
  });
  return {
    format: "idea-hq-export-1",
    exportedAt: new Date().toISOString(),
    notice: "Everything Idea HQ holds about this account. Passwords, session data and API keys are never stored in readable form and are not included. Support tickets contain your customers' details: handle them with care.",
    account: { ...user, signInMethods: signInMethods.map((m) => m.provider) },
    githubConnections: installations,
    projects, ideas, runs, projectMemory: memory, supportSpaces: spaces, supportTickets: cleanTickets, changelogEntries: changelog,
  };
}
