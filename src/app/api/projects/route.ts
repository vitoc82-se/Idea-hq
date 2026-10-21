import { CAPS, tooLong, firstProblem, cleanColor, cleanHttpsUrl, projectRoom } from "@/lib/caps";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { spendByProject } from "@/lib/spend";
import { isStale, workflowUpdateAvailable } from "@/lib/freshness";

export const dynamic = "force-dynamic";

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const projects = await db.project.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { _count: { select: { ideas: true } } },
  });
  const spend = await spendByProject(userId);
  return NextResponse.json(
    projects.map((p) => ({
      ...p,
      spend: spend.get(p.id) ?? { monthUsd: 0, runs: 0, unpriced: 0 },
      freshness: { behind: p.knowledgeBehind, stale: isStale(p.knowledgeBehind), workflowUpdate: workflowUpdateAvailable(p.workflowVersionSeen, p.aiProvider) },
    }))
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
    const name = String(body?.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "A project name is required" }, { status: 400 });
    }
    const url = cleanHttpsUrl(body?.contextSourceUrl);
    const problem = firstProblem(
      tooLong("The name", name, CAPS.projectName),
      tooLong("The project description", typeof body?.context === "string" ? body.context : "", CAPS.projectContext),
      url.ok ? null : url.error,
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const full = await projectRoom(userId);
    if (full) return NextResponse.json({ error: full }, { status: 409 });
    const slug = slugify(body?.slug ? String(body.slug).slice(0, CAPS.projectName) : name) || slugify(name);
    if (!slug) {
      return NextResponse.json({ error: "Could not derive a slug from the name" }, { status: 400 });
    }

    // Slug must be unique per user (drives clean URLs / dedupe).
    const clash = await db.project.findFirst({ where: { userId, slug }, select: { id: true } });
    if (clash) {
      return NextResponse.json(
        { error: `You already have a project with slug "${slug}"` },
        { status: 409 }
      );
    }

    const project = await db.project.create({
      data: {
        userId,
        name,
        slug,
        color: cleanColor(body?.color),
        context: typeof body?.context === "string" ? body.context : "",
        contextSourceUrl: url.ok ? url.value : null,
        contextUpdatedAt: new Date(),
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Could not create the project. Try again in a moment." }, { status: 500 });
  }
}
