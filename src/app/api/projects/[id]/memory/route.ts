import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { addMemory, loadKnowledge } from "@/lib/knowledge-store";
import { db } from "@/lib/db";
import { CAPS, tooLong } from "@/lib/caps";

const KINDS = ["change", "lesson", "gotcha", "decision", "user"];

// Add a fact by hand. Pinned facts are always handed to the AI.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    if (!(await loadKnowledge(auth.userId, params.id))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const b = await request.json().catch(() => null);
    const text = String(b?.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Write the fact first." }, { status: 400 });
    const tooBig = tooLong("The fact", text, CAPS.memoryText);
    if (tooBig) return NextResponse.json({ error: tooBig }, { status: 400 });
    if (b?.pinned !== false && (await db.projectMemory.count({ where: { projectId: params.id, userId: auth.userId, pinned: true } })) >= CAPS.pinnedFacts) {
      return NextResponse.json({ error: `You already have ${CAPS.pinnedFacts} pinned facts. Unpin or remove some first.` }, { status: 409 });
    }
    const row = await addMemory(auth.userId, params.id, {
      kind: KINDS.includes(b?.kind) ? b.kind : "user", text, pinned: b?.pinned !== false, source: "you",
    });
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (e) {
    return errorResponse(e);
  }
}
