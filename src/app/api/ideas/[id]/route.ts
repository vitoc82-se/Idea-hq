import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { normalizeTags } from "@/app/(app)/ideas/ideas-shared";

const STATUSES = ["new", "considering", "building", "done", "parked"];
const PRIORITIES = ["none", "low", "medium", "high"];
const IMPACTS = ["low", "medium", "high"];
const COMPLEXITIES = ["S", "M", "L", "XL"];

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.idea.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const data: {
      title?: string;
      notes?: string | null;
      status?: string;
      priority?: string;
      impact?: string;
      complexity?: string;
      tags?: string[];
      blockedBy?: string[];
    } = {};
    if (typeof body?.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (STATUSES.includes(body?.status)) data.status = body.status;
    if (PRIORITIES.includes(body?.priority)) data.priority = body.priority;
    if (IMPACTS.includes(body?.impact)) data.impact = body.impact;
    if (COMPLEXITIES.includes(body?.complexity)) data.complexity = body.complexity;

    if (Array.isArray(body?.tags)) {
      data.tags = normalizeTags(body.tags.map((t: unknown) => String(t)));
    }

    if (Array.isArray(body?.blockedBy)) {
      // Keep only real ideas owned by this user, never the idea itself.
      const rawIds = (body.blockedBy as unknown[]).map((x) => String(x));
      const wanted: string[] = Array.from(new Set(rawIds)).filter(
        (id) => id !== params.id
      );
      if (wanted.length === 0) {
        data.blockedBy = [];
      } else {
        const valid = await db.idea.findMany({
          where: { userId, id: { in: wanted } },
          select: { id: true },
        });
        data.blockedBy = valid.map((v) => v.id);
      }
    }

    const idea = await db.idea.update({ where: { id: params.id }, data });
    return NextResponse.json(idea);
  } catch (error) {
    console.error("Update idea error:", error);
    return NextResponse.json({ error: "Failed to update idea" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.idea.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  await db.idea.delete({ where: { id: params.id } });
  return NextResponse.json({ message: "Idea deleted" });
}
