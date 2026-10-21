import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { emailReply, isStatus } from "@/lib/support/owner-tickets";

// Owner: try again to email the latest reply that did not go out.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const t = await db.ticket.findFirst({
    where: { id: params.id, project: { userId: auth.userId } },
    select: { id: true, number: true, status: true, customerEmail: true, tokenHash: true, project: { select: { name: true, support: { select: { title: true } } } } },
  });
  if (!t) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const last = await db.ticketMessage.findFirst({ where: { ticketId: t.id, author: "owner" }, orderBy: { createdAt: "desc" } });
  if (!last) return NextResponse.json({ error: "There is no reply to send" }, { status: 400 });
  const emailed = await emailReply({ ...t, status: isStatus(t.status) ? t.status : "pending" }, t.project.support?.title || t.project.name, last.body);
  if (emailed) await db.ticketMessage.update({ where: { id: last.id }, data: { emailedAt: new Date() } });
  return NextResponse.json({ ok: true, emailed });
}
