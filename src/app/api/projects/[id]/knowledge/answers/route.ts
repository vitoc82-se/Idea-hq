import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser, requireAi, errorResponse } from "@/lib/runs/http";
import { loadKnowledge, saveKnowledge, addMemory } from "@/lib/knowledge-store";
import { foldAnswers, type Answer } from "@/lib/knowledge-ai";
import { isSectionId, completeness } from "@/lib/knowledge";
import { PLANNING_MODEL } from "@/lib/runs/policy";

// Folds the owner's answers into the knowledge. Answers are the owner's own
// words, so the sections they touch count as confirmed.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const loaded = await loadKnowledge(auth.userId, params.id);
  if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const b = await request.json().catch(() => null);
  const answers: Answer[] = (Array.isArray(b?.answers) ? b.answers : [])
    .filter((a: Answer) => a && isSectionId(a.section) && typeof a.answer === "string" && a.answer.trim())
    .slice(0, 8)
    .map((a: Answer) => ({ section: a.section, question: String(a.question || "").slice(0, 300), answer: a.answer.trim().slice(0, 1000) }));
  if (!answers.length) return NextResponse.json({ error: "Answer at least one question." }, { status: 400 });
  const blocked = await requireAi(auth.userId, auth.email);
  if (blocked) return blocked;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const next = await foldAnswers(anthropic, PLANNING_MODEL.estimate, loaded.project.name, loaded.knowledge, answers);
    await saveKnowledge(auth.userId, params.id, next);
    await addMemory(auth.userId, params.id, { kind: "user", text: `Owner answered ${answers.length} question${answers.length > 1 ? "s" : ""} about the project.`, source: "auto" });
    return NextResponse.json({ ok: true, completeness: completeness(next) });
  } catch (e) {
    return errorResponse(e);
  }
}
