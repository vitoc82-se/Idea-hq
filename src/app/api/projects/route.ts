import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";

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
  return NextResponse.json(projects);
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
    const slug = slugify(body?.slug ? String(body.slug) : name) || slugify(name);
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
        color: body?.color ? String(body.color) : null,
        context: body?.context ? String(body.context) : "",
        contextSourceUrl: body?.contextSourceUrl ? String(body.contextSourceUrl) : null,
        contextUpdatedAt: new Date(),
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Could not create the project. Try again in a moment." }, { status: 500 });
  }
}
