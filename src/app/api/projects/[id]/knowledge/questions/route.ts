import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser, requireAi, errorResponse } from "@/lib/runs/http";
import { loadKnowledge } from "@/lib/knowledge-store";
import { askQuestions } from "@/lib/knowledge-ai";
import { PLANNING_MODEL } from "@/lib/runs/policy";

// Optional interview: a few plain questions about the gaps.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const loaded = await loadKnowledge(auth.userId, params.id);
  if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const blocked = await requireAi(auth.userId, auth.email);
  if (blocked) return blocked;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const questions = await askQuestions(anthropic, PLANNING_MODEL.estimate, loaded.project.name, loaded.knowledge, loaded.memory);
    if (!questions.length) return NextResponse.json({ error: "Nothing to ask right now. The knowledge looks complete." }, { status: 200 });
    return NextResponse.json({ questions });
  } catch (e) {
    return errorResponse(e);
  }
}
