import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { cleanKind, cleanSeverity } from "@/lib/issues";
import { cleanText } from "@/lib/support/sanitize";
import { CAPS, tooLong, firstProblem, ideaRoom } from "@/lib/caps";
import { isPracticeTitle } from "@/lib/runs/practice";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "considering", "building", "done", "parked"];
const PRIORITIES = ["none", "low", "medium", "high"];

// Ideas always come back with a lightweight project reference so the board can
// show which product each idea belongs to and rank across all of them.
const withProject = {
  include: {
    project: { select: { name: true, color: true } },
    _count: { select: { children: true, tickets: true } },
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
  // Where each idea stands on the journey (see lib/runs/journey.ts): its latest build and, for one split into steps, the steps.
  const ids = ideas.map((i) => i.id);
  const [runs, kids] = ids.length
    ? await Promise.all([
        db.run.findMany({
          where: { userId, ideaId: { in: ids }, kind: "implement" },
          orderBy: { createdAt: "desc" },
          distinct: ["ideaId"],
          select: { ideaId: true, id: true, status: true, kind: true, checksState: true },
        }),
        db.idea.findMany({ where: { userId, parentId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { id: true, parentId: true, status: true, blockedBy: true } }),
      ])
    : [[], []];
  const runOf = new Map(runs.map((r) => [r.ideaId, { id: r.id, status: r.status, kind: r.kind, checksState: r.checksState }]));
  return NextResponse.json(
    ideas.map((i) => {
      const own = kids.filter((k) => k.parentId === i.id);
      const done = new Set(own.filter((k) => k.status === "done").map((k) => k.id));
      const next = own.find((k) => k.status !== "done" && k.blockedBy.every((b) => done.has(b)));
      return {
        ...i,
        latestRun: runOf.get(i.id) ?? null,
        epic: own.length ? { children: own.map((k) => ({ id: k.id, status: k.status })), nextId: next?.id ?? null } : null,
      };
    })
  );
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

    const problem = firstProblem(tooLong("The title", title, CAPS.title), tooLong("The notes", typeof body?.notes === "string" ? body.notes : "", CAPS.notes));
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const kind = cleanKind(body?.kind) ?? "idea";
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

    const full = await ideaRoom(project.id);
    if (full) return NextResponse.json({ error: full }, { status: 409 });

    const idea = await db.idea.create({
      data: {
        userId,
        projectId: project.id,
        title,
        notes: body?.notes ? String(body.notes) : null,
        status: STATUSES.includes(body?.status) ? body.status : "new",
        priority: PRIORITIES.includes(body?.priority) ? body.priority : "none",
        // The setup journey's practice idea is a known one-line change: sized small up front, no AI estimate needed.
        ...(isPracticeTitle(title) ? { complexity: "S", impact: "low", scope: "One line added to the README.", aiEstimatedAt: new Date() } : {}),
        ...(kind === "bug" ? { kind: "bug", severity: cleanSeverity(body?.severity) ?? "medium", repro: cleanText(body?.repro, 4000) || null } : {}),
      },
      ...withProject,
    });
    return NextResponse.json(idea, { status: 201 });
  } catch (error) {
    logError("Create idea error:", error);
    return NextResponse.json({ error: "Could not save the idea. Try again in a moment." }, { status: 500 });
  }
}
