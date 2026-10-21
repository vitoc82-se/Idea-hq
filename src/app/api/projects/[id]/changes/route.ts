import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/runs/http";
import { newChangelogKey } from "@/lib/changelog";
import { baseUrl } from "@/lib/support/email";

export const dynamic = "force-dynamic";

async function owned(id: string, userId: string) {
  return db.project.findFirst({ where: { id, userId }, select: { id: true, name: true, changelogKey: true, changelogOn: true } });
}

// The project's What's new page: is it on, its address, and every entry (drafts first).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await owned(params.id, auth.userId);
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const entries = await db.changelogEntry.findMany({
    where: { projectId: p.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, kind: true, title: true, body: true, publishedAt: true, createdAt: true, runId: true },
  });
  return NextResponse.json({
    name: p.name,
    enabled: p.changelogOn,
    url: p.changelogKey ? `${baseUrl()}/changes/${p.changelogKey}` : null,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, title: e.title, body: e.body, publishedAt: e.publishedAt, createdAt: e.createdAt, fromChange: !!e.runId })),
  });
}

// Switch the public page on or off. The address is made the first time and then stays the same.
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean" || Object.keys(body).length !== 1) {
    return NextResponse.json({ error: "Send enabled: true or false." }, { status: 400 });
  }
  const p = await owned(params.id, auth.userId);
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  let key = p.changelogKey;
  if (body.enabled && !key) {
    for (let i = 0; i < 3 && !key; i++) {
      const candidate = newChangelogKey();
      try {
        await db.project.update({ where: { id: p.id }, data: { changelogKey: candidate } });
        key = candidate;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
    }
    if (!key) return NextResponse.json({ error: "Could not make the page address. Try again." }, { status: 500 });
  }
  await db.project.update({ where: { id: p.id }, data: { changelogOn: body.enabled } });
  return NextResponse.json({ enabled: body.enabled, url: key ? `${baseUrl()}/changes/${key}` : null });
}
