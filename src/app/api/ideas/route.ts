import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "considering", "building", "done", "parked"];
const PRIORITIES = ["none", "low", "medium", "high"];

// Ideas always come back with a lightweight project reference so the board can
// show which product each idea belongs to and rank across all of them.
const withProject = {
  include: {
    project: { select: { name: true, color: true } },
    _count: { select: { children: true } },
  },
} as const;

export async function GET(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  // Optional ?projectId= filter; omitted → every project (the cross-project view).
  const projectId = new URL(request.url).searchParams.get("projectId");

  // Only top-level ideas on the board — child stories live on their epic's page.
  const ideas = await db.idea.findMany({
    where: { userId, parentId: null, ...(projectId ? { projectId } : {}) },
    orderBy: [{ createdAt: "desc" }],
    ...withProject,
  });
  return NextResponse.json(ideas);
}

export async function POST(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = String(body?.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "A title is required" }, { status: 400 });
    }

    const projectId = String(body?.projectId ?? "").trim();
    if (!projectId) {
      return NextResponse.json(
        { error: "Pick a project for this idea" },
        { status: 400 }
      );
    }
    // Never trust the client's projectId — it must be one of this user's projects.
    const project = await db.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Unknown project" }, { status: 400 });
    }

    const idea = await db.idea.create({
      data: {
        userId,
        projectId: project.id,
        title,
        notes: body?.notes ? String(body.notes) : null,
        status: STATUSES.includes(body?.status) ? body.status : "new",
        priority: PRIORITIES.includes(body?.priority) ? body.priority : "none",
      },
      ...withProject,
    });
    return NextResponse.json(idea, { status: 201 });
  } catch (error) {
    console.error("Create idea error:", error);
    return NextResponse.json({ error: "Could not save the idea. Try again in a moment." }, { status: 500 });
  }
}
