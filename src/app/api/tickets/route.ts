import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { confirmedNotes } from "@/lib/support/notes";
import { FILTERS, filterWhere, type Filter } from "@/lib/support/owner-tickets";

// Owner: the inbox list across all projects (or one).
export async function GET(request: Request) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const url = new URL(request.url);
  const f = url.searchParams.get("filter") || "all";
  const filter: Filter = (FILTERS as readonly string[]).includes(f) ? (f as Filter) : "all";
  const projectId = url.searchParams.get("project");
  const where = { project: { userId: auth.userId }, ...(projectId ? { projectId } : {}), ...filterWhere(filter) };
  const tickets = await db.ticket.findMany({
    where,
    orderBy: { lastActivityAt: "desc" },
    take: 100,
    select: {
      id: true, number: true, status: true, subject: true, customerEmail: true, customerName: true, aiAnswered: true,
      unread: true, lastActivityAt: true, projectId: true, project: { select: { name: true } },
    },
  });
  const projects = await db.project.findMany({
    where: { userId: auth.userId },
    select: { id: true, name: true, support: { select: { enabled: true, formSchema: true, allowedOrigins: true, supportKnowledge: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    tickets: tickets.map((t: { project: { name: string } } & Record<string, unknown>) => ({ ...t, projectName: t.project.name, project: undefined })),
    projects: projects.map((p: { id: string; name: string; support: { enabled: boolean; formSchema: unknown; allowedOrigins: string[]; supportKnowledge: unknown } | null }) => ({
      id: p.id,
      name: p.name,
      supportOn: !!p.support?.enabled,
      // First-time checklist: what has been done for this project so far.
      setup: {
        formChosen: p.support?.formSchema != null,
        notesReviewed: confirmedNotes(p.support?.supportKnowledge).length > 0,
        siteAdded: (p.support?.allowedOrigins.length ?? 0) > 0,
      },
    })),
  });
}
