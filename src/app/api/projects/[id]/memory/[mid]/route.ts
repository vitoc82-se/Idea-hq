import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { loadKnowledge, saveKnowledge } from "@/lib/knowledge-store";

async function refresh(userId: string, projectId: string) {
  const loaded = await loadKnowledge(userId, projectId);
  if (loaded) await saveKnowledge(userId, projectId, loaded.knowledge);
}

// Pin, unpin or reword a remembered fact.
export async function PATCH(request: Request, { params }: { params: { id: string; mid: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const m = await db.projectMemory.findFirst({ where: { id: params.mid, projectId: params.id, userId: auth.userId } });
    if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b = await request.json().catch(() => ({}));
    const data: { pinned?: boolean; text?: string } = {};
    if (typeof b.pinned === "boolean") data.pinned = b.pinned;
    if (typeof b.text === "string" && b.text.trim()) data.text = b.text.trim().slice(0, 600);
    if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    await db.projectMemory.update({ where: { id: m.id }, data });
    await refresh(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string; mid: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const m = await db.projectMemory.findFirst({ where: { id: params.mid, projectId: params.id, userId: auth.userId } });
    if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.projectMemory.deleteMany({ where: { id: m.id, userId: auth.userId } });
    await refresh(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
