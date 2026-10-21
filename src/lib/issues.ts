import { db } from "./db";
import { cleanText } from "./support/sanitize";
import { LIMITS } from "./support/constants";
import { emailReply, statusPatch } from "./support/owner-tickets";
import { repoMayBePublic, redactPersonalDetails } from "./runs/public-safe";

// Bugs and the link between support tickets and the idea board. A bug is an idea with
// a different start (what happens, steps, severity) and a different job for the AI
// (reproduce first, then fix). Support tickets can be turned into a bug or an idea, and
// when it ships the customers who asked can be told in one go.

export class IssueError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const KINDS = ["idea", "bug"] as const;
export type Kind = (typeof KINDS)[number];
export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Record<Severity, string> = { low: "Minor", medium: "Normal", high: "Serious" };

export const cleanKind = (v: unknown): Kind | null => (typeof v === "string" && (KINDS as readonly string[]).includes(v) ? (v as Kind) : null);
export const cleanSeverity = (v: unknown): Severity | null => (typeof v === "string" && (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : null);

const TITLE_MAX = 200;
const NOTES_MAX = 8000;
const REPRO_MAX = 4000;

// What the person sees pre-filled when they turn a ticket into a bug or idea. It is a
// draft they read and edit; nothing is saved until they confirm.
export async function draftFromTicket(userId: string, ticketId: string) {
  const t = await db.ticket.findFirst({
    where: { id: ticketId, project: { userId } },
    select: {
      id: true, number: true, subject: true, fields: true, ideaId: true, projectId: true,
      project: { select: { repoPrivate: true } },
      messages: { where: { author: "customer" }, orderBy: { createdAt: "asc" }, take: 1, select: { body: true } },
    },
  });
  if (!t) throw new IssueError(404, "Ticket not found.");
  const fields = Array.isArray(t.fields) ? (t.fields as { label?: unknown; value?: unknown }[]) : [];
  const details = fields
    .filter((f) => typeof f?.label === "string" && typeof f?.value === "string" && f.value)
    .map((f) => `${cleanText(f.label, 60)}: ${cleanText(f.value, 200)}`)
    .slice(0, 12);
  const message = t.messages[0]?.body ?? "";
  const notes = [`Reported by a customer in support ticket #${t.number}:`, "", cleanText(message, 3000), ...(details.length ? ["", "Details they gave:", ...details] : [])].join("\n");
  // The idea ends up in the repo's Actions logs and pull requests. When that repo is (or may be) public, a
  // customer's email address or phone number must not travel with it.
  const strip = repoMayBePublic(t.project);
  const cleaned = strip ? redactPersonalDetails(notes) : notes;
  const title = cleanText(t.subject, TITLE_MAX);
  return {
    ticketId: t.id, projectId: t.projectId, linkedIdeaId: t.ideaId,
    title: strip ? redactPersonalDetails(title) : title,
    notes: cleaned,
    repoPublic: t.project.repoPrivate === false,
    personalDetailsRemoved: strip && (cleaned !== notes || (strip && redactPersonalDetails(title) !== title)),
  };
}

export type IssueInput = { kind: unknown; title: unknown; notes?: unknown; repro?: unknown; severity?: unknown };

export async function createIssueFromTicket(userId: string, ticketId: string, input: IssueInput) {
  const kind = cleanKind(input.kind) ?? "bug";
  const rawTitle = cleanText(input.title, TITLE_MAX);
  if (!rawTitle) throw new IssueError(400, "Give it a title.");
  const rawNotes = cleanText(input.notes, NOTES_MAX) || null;
  const rawRepro = kind === "bug" ? cleanText(input.repro, REPRO_MAX) || null : null;
  const severity = kind === "bug" ? cleanSeverity(input.severity) ?? "medium" : null;

  const t = await db.ticket.findFirst({ where: { id: ticketId, project: { userId } }, select: { id: true, projectId: true, ideaId: true, project: { select: { repoPrivate: true } } } });
  if (!t) throw new IssueError(404, "Ticket not found.");
  // Same rule as the draft: a possibly public repo never gets a customer's email or phone number.
  const strip = repoMayBePublic(t.project);
  const title = strip ? redactPersonalDetails(rawTitle) : rawTitle;
  const notes = strip && rawNotes ? redactPersonalDetails(rawNotes) : rawNotes;
  const repro = strip && rawRepro ? redactPersonalDetails(rawRepro) : rawRepro;
  if (t.ideaId) throw new IssueError(409, "This ticket is already linked. Unlink it first if you want to create a new one.");

  return db.$transaction(async (tx) => {
    const idea = await tx.idea.create({
      data: { userId, projectId: t.projectId, title, notes, kind, severity, repro, status: "new", priority: severity === "high" ? "high" : "none" },
      select: { id: true, title: true, kind: true, status: true },
    });
    const linked = await tx.ticket.updateMany({ where: { id: t.id, ideaId: null }, data: { ideaId: idea.id } });
    if (linked.count !== 1) throw new IssueError(409, "This ticket was linked just now. Reload and look again.");
    return idea;
  });
}

export async function linkTicket(userId: string, ticketId: string, ideaId: unknown) {
  if (typeof ideaId !== "string" || !ideaId) throw new IssueError(400, "Pick a bug or idea to add it to.");
  const t = await db.ticket.findFirst({ where: { id: ticketId, project: { userId } }, select: { id: true, projectId: true } });
  if (!t) throw new IssueError(404, "Ticket not found.");
  const idea = await db.idea.findFirst({ where: { id: ideaId, userId, projectId: t.projectId, parentId: null }, select: { id: true, title: true, kind: true, status: true } });
  if (!idea) throw new IssueError(404, "That bug or idea was not found in this project.");
  if (idea.status === "done") throw new IssueError(409, "That one is already marked done. Create a new bug instead, or reopen it first.");
  await db.ticket.update({ where: { id: t.id }, data: { ideaId: idea.id } });
  return idea;
}

export async function unlinkTicket(userId: string, ticketId: string) {
  const t = await db.ticket.findFirst({ where: { id: ticketId, project: { userId } }, select: { id: true } });
  if (!t) throw new IssueError(404, "Ticket not found.");
  await db.ticket.update({ where: { id: t.id }, data: { ideaId: null } });
}

// Open bugs and ideas of the ticket's project that it could be added to.
export async function linkCandidates(userId: string, ticketId: string) {
  const t = await db.ticket.findFirst({ where: { id: ticketId, project: { userId } }, select: { projectId: true } });
  if (!t) throw new IssueError(404, "Ticket not found.");
  return db.idea.findMany({
    where: { userId, projectId: t.projectId, parentId: null, status: { not: "done" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, kind: true, status: true },
  });
}

const NOTIFY_STATUSES = ["open", "pending", "resolved"];

export function defaultCustomerMessage(idea: { title: string; kind: string }): string {
  return idea.kind === "bug"
    ? `Good news: the problem you reported ("${idea.title}") is fixed. Thank you for letting us know. If you still see it, just reply here.`
    : `Good news: what you asked for ("${idea.title}") is now live. Thank you for the suggestion. If something is not right, just reply here.`;
}

export async function reportsFor(userId: string, ideaId: string) {
  const idea = await db.idea.findFirst({ where: { id: ideaId, userId }, select: { id: true, title: true, kind: true, status: true, customersNotifiedAt: true } });
  if (!idea) throw new IssueError(404, "Idea not found.");
  const tickets = await db.ticket.findMany({
    where: { ideaId, project: { userId } },
    orderBy: { number: "asc" },
    take: 200,
    select: { id: true, number: true, subject: true, customerName: true, status: true },
  });
  const reachable = tickets.filter((t) => NOTIFY_STATUSES.includes(t.status)).length;
  return {
    tickets,
    canNotify: idea.status === "done" && !idea.customersNotifiedAt && reachable > 0,
    reachable,
    notifiedAt: idea.customersNotifiedAt ? idea.customersNotifiedAt.toISOString() : null,
    defaultMessage: defaultCustomerMessage(idea),
  };
}

// Tell every customer whose ticket is linked to this idea that it shipped. Each gets the
// message in their ticket (and by email), and the ticket is marked resolved. Once only.
export async function notifyCustomers(userId: string, ideaId: string, rawMessage: unknown) {
  const message = cleanText(rawMessage, LIMITS.replyMax + 1);
  if (!message) throw new IssueError(400, "Write the message the customers will get.");
  if (message.length > LIMITS.replyMax) throw new IssueError(400, `Keep it under ${LIMITS.replyMax} characters.`);
  const idea = await db.idea.findFirst({ where: { id: ideaId, userId }, select: { id: true, status: true, customersNotifiedAt: true } });
  if (!idea) throw new IssueError(404, "Idea not found.");
  if (idea.status !== "done") throw new IssueError(409, "Mark it done (merge its change) before telling customers.");
  if (idea.customersNotifiedAt) throw new IssueError(409, "The customers were already told.");

  // Claim it first, so two clicks at once cannot send everything twice.
  const claimed = await db.idea.updateMany({ where: { id: idea.id, customersNotifiedAt: null }, data: { customersNotifiedAt: new Date() } });
  if (claimed.count !== 1) throw new IssueError(409, "The customers were already told.");

  const tickets = await db.ticket.findMany({
    where: { ideaId, project: { userId }, status: { in: NOTIFY_STATUSES } },
    take: 200,
    select: { id: true, number: true, customerEmail: true, tokenHash: true, project: { select: { name: true, support: { select: { title: true } } } } },
  });
  if (tickets.length === 0) {
    await db.idea.update({ where: { id: idea.id }, data: { customersNotifiedAt: null } });
    throw new IssueError(409, "No open tickets are linked to this.");
  }
  let emailed = 0;
  for (const t of tickets) {
    const msg = await db.ticketMessage.create({ data: { ticketId: t.id, author: "owner", body: message } });
    await db.ticket.update({ where: { id: t.id }, data: { ...statusPatch("resolved"), unread: false, lastActivityAt: new Date() } });
    const title = t.project.support?.title || t.project.name;
    const ok = await emailReply({ ...t, status: "resolved" }, title, message).catch(() => false);
    if (ok) {
      emailed++;
      await db.ticketMessage.update({ where: { id: msg.id }, data: { emailedAt: new Date() } });
    }
  }
  return { notified: tickets.length, emailed };
}
