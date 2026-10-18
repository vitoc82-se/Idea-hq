import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { requireAi, errorResponse } from "@/lib/runs/http";
import { loadKnowledge } from "@/lib/knowledge-store";
import { PLANNING_MODEL } from "@/lib/runs/policy";
import { parseNotes, type Note } from "@/lib/support/notes";
import { buildNotesDraftPrompt, parseNotesDraft } from "@/lib/support/notes-draft";
import { LIMITS } from "@/lib/support/constants";

// Owner: draft customer-facing help notes from the project's internal knowledge.
// Drafts always need the owner's review; only confirmed notes ever reach customers.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const loaded = await loadKnowledge(auth.userId, params.id);
  if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const space = await db.supportSpace.findUnique({ where: { projectId: params.id }, select: { supportKnowledge: true } });
  if (!space) return NextResponse.json({ error: "Turn on support for this project first." }, { status: 400 });
  const blocked = await requireAi(auth.userId, auth.email);
  if (blocked) return blocked;
  try {
    const existing = parseNotes(space.supportKnowledge);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: PLANNING_MODEL.context,
      max_tokens: 3000,
      messages: [{ role: "user", content: buildNotesDraftPrompt(loaded.project.name, loaded.project.context || "", existing) }],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const drafts = parseNotesDraft(text, existing);
    if (!drafts.length) return NextResponse.json({ error: "Could not write any help notes from the project knowledge. Fill in the project knowledge first, or write the notes yourself." }, { status: 422 });
    const notes: Note[] = [...existing, ...drafts].slice(0, LIMITS.maxNotes);
    await db.supportSpace.update({ where: { projectId: params.id }, data: { supportKnowledge: { notes } } });
    return NextResponse.json({ notes, added: drafts.length });
  } catch (e) {
    return errorResponse(e);
  }
}
