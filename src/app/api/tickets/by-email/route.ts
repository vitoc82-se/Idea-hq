import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { normalizeEmail } from "@/lib/support/sanitize";

// Owner: delete every ticket from one customer address in one project (privacy requests).
export async function DELETE(request: Request) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || typeof body?.projectId !== "string") return NextResponse.json({ error: "projectId and a valid email are required" }, { status: 400 });
  const project = await db.project.findFirst({ where: { id: body.projectId, userId: auth.userId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const res = await db.ticket.deleteMany({ where: { projectId: project.id, customerEmail: email } });
  return NextResponse.json({ ok: true, deleted: res.count });
}
