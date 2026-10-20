import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/runs/http";
import { cleanEntryPatch } from "@/lib/changelog";

// Write an entry by hand (for a change that did not go through Idea HQ).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const checked = cleanEntryPatch(await request.json().catch(() => null), { requireTitle: true });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { published, ...rest } = checked.patch;
  const entry = await db.changelogEntry.create({
    data: { projectId: p.id, title: rest.title!, body: rest.body ?? null, kind: rest.kind ?? "new", publishedAt: published ? new Date() : null },
    select: { id: true, kind: true, title: true, body: true, publishedAt: true, createdAt: true },
  });
  return NextResponse.json({ entry }, { status: 201 });
}
