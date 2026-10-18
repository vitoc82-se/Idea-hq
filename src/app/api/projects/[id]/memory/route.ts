import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { addMemory, loadKnowledge } from "@/lib/knowledge-store";

const KINDS = ["change", "lesson", "gotcha", "decision", "user"];

// Add a fact by hand. Pinned facts are always handed to the AI.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    if (!(await loadKnowledge(auth.userId, params.id))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const b = await request.json().catch(() => null);
    const text = String(b?.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Write the fact first." }, { status: 400 });
    const row = await addMemory(auth.userId, params.id, {
      kind: KINDS.includes(b?.kind) ? b.kind : "user", text, pinned: b?.pinned !== false, source: "you",
    });
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (e) {
    return errorResponse(e);
  }
}
