import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { normalizeEmail } from "@/lib/support/sanitize";

// Owner: export tickets as JSON, for one project, optionally one customer address.
export async function GET(request: Request) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project is required" }, { status: 400 });
  const project = await db.project.findFirst({ where: { id: projectId, userId: auth.userId }, select: { id: true, name: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const emailParam = url.searchParams.get("email");
  const email = emailParam ? normalizeEmail(emailParam) : null;
  if (emailParam && !email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const tickets = await db.ticket.findMany({
    where: { projectId: project.id, ...(email ? { customerEmail: email } : {}) },
    orderBy: { number: "asc" },
    take: 5000,
    select: {
      number: true, status: true, subject: true, customerEmail: true, customerName: true, fields: true, aiAnswered: true, createdAt: true, closedAt: true,
      messages: { orderBy: { createdAt: "asc" }, select: { author: true, body: true, createdAt: true } },
    },
  });
  return new NextResponse(JSON.stringify({ project: project.name, exportedAt: new Date().toISOString(), tickets }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickets-${project.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
