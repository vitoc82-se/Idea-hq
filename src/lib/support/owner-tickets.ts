import { db } from "@/lib/db";
import { hashToken, deriveTicketToken } from "./tokens";
import { customerReplyEmail, sendEmail, ticketLink } from "./email";
import { STATUSES, type TicketStatus } from "./constants";

// Owner-side ticket helpers. Every query is scoped through the project's owner.

export const FILTERS = ["all", "needs", "waiting", "ai", "closed"] as const;
export type Filter = (typeof FILTERS)[number];

export function filterWhere(filter: Filter): Record<string, unknown> {
  switch (filter) {
    case "needs": return { status: "open" };
    case "waiting": return { status: "pending" };
    case "ai": return { aiAnswered: true };
    case "closed": return { status: { in: ["resolved", "closed"] } };
    default: return {};
  }
}

export function isStatus(x: unknown): x is TicketStatus {
  return typeof x === "string" && (STATUSES as readonly string[]).includes(x);
}

export function statusPatch(status: TicketStatus, now = new Date()) {
  const done = status === "resolved" || status === "closed";
  return { status, needsHuman: status === "open", closedAt: done ? now : null };
}

type TicketForMail = { id: string; number: number; customerEmail: string; tokenHash: string };

// The customer's link. If the server secret was rotated, the old hash no longer
// matches; issue the current link and store its hash so it works.
export async function linkFor(ticket: TicketForMail): Promise<string> {
  const token = deriveTicketToken(ticket.id);
  const hash = hashToken(token);
  if (hash !== ticket.tokenHash) await db.ticket.update({ where: { id: ticket.id }, data: { tokenHash: hash } });
  return ticketLink(token);
}

export async function emailReply(ticket: TicketForMail & { status: TicketStatus }, title: string, body: string): Promise<boolean> {
  const link = await linkFor(ticket);
  const mail = customerReplyEmail({ title, number: ticket.number, link, body, status: ticket.status });
  return sendEmail({ to: ticket.customerEmail, fromName: title, ...mail });
}
