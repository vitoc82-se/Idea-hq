import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { emailReply } from "@/lib/support/owner-tickets";
import { cleanText } from "@/lib/support/sanitize";
import { LIMITS } from "@/lib/support/constants";

// Owner: reply to the customer. Saved first, then emailed with the private link.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  const text = cleanText(body?.body, LIMITS.replyMax + 1);
  if (!text) return NextResponse.json({ error: "Write a reply" }, { status: 400 });
  if (text.length > LIMITS.replyMax) return NextResponse.json({ error: `Keep it under ${LIMITS.replyMax} characters` }, { status: 400 });
  const t = await db.ticket.findFirst({
    where: { id: params.id, project: { userId: auth.userId } },
    select: { id: true, number: true, customerEmail: true, tokenHash: true, project: { select: { name: true, support: { select: { title: true } } } } },
  });
  if (!t) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const message = await db.ticketMessage.create({ data: { ticketId: t.id, author: "owner", body: text } });
  await db.ticket.update({ where: { id: t.id }, data: { status: "pending", needsHuman: false, unread: false, lastActivityAt: new Date(), closedAt: null } });

  const title = t.project.support?.title || t.project.name;
  const emailed = await emailReply({ ...t, status: "pending" }, title, text);
  if (emailed) await db.ticketMessage.update({ where: { id: message.id }, data: { emailedAt: new Date() } });
  return NextResponse.json({ ok: true, emailed, messageId: message.id });
}
