import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { isStatus, statusPatch } from "@/lib/support/owner-tickets";

const owned = (id: string, userId: string) => ({ id, project: { userId } });

// Owner: one ticket with its conversation. Opening it marks it read.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const t = await db.ticket.findFirst({
    where: owned(params.id, auth.userId),
    select: {
      id: true, number: true, status: true, subject: true, customerEmail: true, customerName: true, fields: true, aiAnswered: true,
      unread: true, createdAt: true, lastActivityAt: true, projectId: true, project: { select: { name: true } },
      ideaId: true, idea: { select: { id: true, title: true, kind: true, status: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, author: true, body: true, createdAt: true, emailedAt: true } },
    },
  });
  if (!t) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (t.unread) await db.ticket.update({ where: { id: t.id }, data: { unread: false } });
  const { project, ...rest } = t as typeof t & { project: { name: string } };
  return NextResponse.json({ ticket: { ...rest, unread: false, projectName: project.name } });
}

// Owner: change the status.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  if (!body || !isStatus(body.status)) return NextResponse.json({ error: "status must be open, pending, resolved or closed" }, { status: 400 });
  const t = await db.ticket.findFirst({ where: owned(params.id, auth.userId), select: { id: true } });
  if (!t) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const updated = await db.ticket.update({ where: { id: t.id }, data: statusPatch(body.status), select: { id: true, status: true } });
  return NextResponse.json({ ticket: updated });
}

// Owner: delete one ticket and its messages for good.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const t = await db.ticket.findFirst({ where: owned(params.id, auth.userId), select: { id: true } });
  if (!t) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  await db.ticket.delete({ where: { id: t.id } });
  return NextResponse.json({ ok: true });
}
