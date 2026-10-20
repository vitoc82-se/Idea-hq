import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/runs/http";
import { cleanEntryPatch } from "@/lib/changelog";

async function owned(entryId: string, projectId: string, userId: string) {
  return db.changelogEntry.findFirst({ where: { id: entryId, projectId, project: { userId } }, select: { id: true, publishedAt: true } });
}

// Edit the words, change the type, publish or unpublish.
export async function PATCH(request: Request, { params }: { params: { id: string; entryId: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const e = await owned(params.entryId, params.id, auth.userId);
  if (!e) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  const checked = cleanEntryPatch(await request.json().catch(() => null));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { published, ...rest } = checked.patch;
  const entry = await db.changelogEntry.update({
    where: { id: e.id },
    data: { ...rest, ...(published === undefined ? {} : { publishedAt: published ? e.publishedAt ?? new Date() : null }) },
    select: { id: true, kind: true, title: true, body: true, publishedAt: true, createdAt: true },
  });
  return NextResponse.json({ entry });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; entryId: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const e = await owned(params.entryId, params.id, auth.userId);
  if (!e) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  await db.changelogEntry.delete({ where: { id: e.id } });
  return NextResponse.json({ ok: true });
}
