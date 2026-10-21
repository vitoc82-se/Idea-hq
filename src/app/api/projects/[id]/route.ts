import { logError } from "@/lib/log";
import { CAPS, tooLong, firstProblem, cleanColor, cleanHttpsUrl } from "@/lib/caps";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { cleanCap } from "@/lib/spend";

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const existing = await db.project.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const data: {
      name?: string;
      color?: string | null;
      context?: string;
      contextSourceUrl?: string | null;
      contextUpdatedAt?: Date;
      monthlyCapUsd?: number | null;
    } = {};

    const url = body?.contextSourceUrl !== undefined ? cleanHttpsUrl(body.contextSourceUrl) : null;
    const problem = firstProblem(
      tooLong("The name", typeof body?.name === "string" ? body.name.trim() : "", CAPS.projectName),
      tooLong("The project description", body?.context === existing.context ? undefined : body?.context, CAPS.projectContext), // (an unchanged older text is never refused)
      url && !url.ok ? url.error : null,
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    if (body?.monthlyCapUsd !== undefined) {
      const cap = cleanCap(body.monthlyCapUsd);
      if (!cap.ok) return NextResponse.json({ error: cap.error }, { status: 400 });
      data.monthlyCapUsd = cap.value;
    }
    if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body?.color !== undefined) data.color = cleanColor(body.color);
    if (url && url.ok) data.contextSourceUrl = url.value;
    // Only bump contextUpdatedAt when the context text actually changes — that
    // timestamp is what marks every existing estimate for this project stale.
    if (typeof body?.context === "string" && body.context !== existing.context) {
      data.context = body.context;
      data.contextUpdatedAt = new Date();
    }

    const project = await db.project.update({ where: { id: params.id }, data });
    return NextResponse.json(project);
  } catch (error) {
    logError("Update project error:", error);
    return NextResponse.json({ error: "Could not update the project. Try again in a moment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const existing = await db.project.findFirst({
    where: { id: params.id, userId },
    include: { _count: { select: { ideas: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Deleting a project cascades to its ideas (schema onDelete: Cascade). Make
  // that explicit to the caller so the UI can warn before it happens.
  await db.project.delete({ where: { id: params.id } });
  return NextResponse.json({ message: "Project deleted", deletedIdeas: existing._count.ideas });
}
