import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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
    } = {};

    if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (body?.color !== undefined) data.color = body.color ? String(body.color) : null;
    if (body?.contextSourceUrl !== undefined) {
      data.contextSourceUrl = body.contextSourceUrl ? String(body.contextSourceUrl) : null;
    }
    // Only bump contextUpdatedAt when the context text actually changes — that
    // timestamp is what marks every existing estimate for this project stale.
    if (typeof body?.context === "string" && body.context !== existing.context) {
      data.context = body.context;
      data.contextUpdatedAt = new Date();
    }

    const project = await db.project.update({ where: { id: params.id }, data });
    return NextResponse.json(project);
  } catch (error) {
    console.error("Update project error:", error);
    return NextResponse.json({ error: "Could not update the project. Try again in a moment." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
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
