import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { normalizeTags } from "@/app/(app)/ideas/ideas-shared";
import { projectPromptContext } from "@/lib/project-context";

const COMPLEXITY_GUIDE = `Complexity scale:
S = a few hours, 1-2 files, no schema change.
M = ~1 day, a handful of files, maybe a small additive schema field.
L = multi-day, a new model/endpoint + UI, or non-trivial logic.
XL = major effort (new platform, big rework, external integration, native app).`;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idea = await db.idea.findFirst({
    where: { id: params.id, userId },
    include: { project: true },
  });
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }
  if (!idea.project) {
    return NextResponse.json(
      { error: "Idea has no project to estimate against." },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI estimation is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Estimating a feature's scope is a reasoning task, and it runs rarely (a
    // few calls when you add ideas), so it uses Claude Opus 5 — the strongest
    // reasoning model — rather than the cheaper Sonnet the high-volume photo
    // analysis uses. Opus 5 has adaptive thinking on by default; max_tokens
    // must leave room for that thinking plus the JSON answer.
    const message = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `${projectPromptContext(idea.project)}

${COMPLEXITY_GUIDE}

A feature idea to estimate:
Title: ${idea.title}
Notes: ${idea.notes || "(none)"}

Estimate what it would take to build this in ${idea.project.name}, and how valuable it is. Return ONLY valid JSON, no other text:
{
  "complexity": "S | M | L | XL",
  "impact": "low | medium | high — how much this improves the product for its users (user value, differentiation, reach). Judge value, not effort.",
  "scope": "2-4 sentences: what it touches (models, endpoints, UI), the rough steps, and any real risk or dependency. Concrete and specific to this app.",
  "suggestedPriority": "low | medium | high",
  "tags": ["1-3 short lowercase theme tags, e.g. ai, ios, growth, nutrition, ux, backend"]
}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json({ error: "No estimate generated" }, { status: 500 });
    }
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const raw = JSON.parse(jsonStr);

    const complexity = ["S", "M", "L", "XL"].includes(raw?.complexity)
      ? raw.complexity
      : "M";
    const impact = ["low", "medium", "high"].includes(raw?.impact)
      ? raw.impact
      : null;
    const scope = typeof raw?.scope === "string" ? raw.scope.trim() : null;
    // Only suggest a priority if the user hasn't set one yet.
    const suggested = ["low", "medium", "high"].includes(raw?.suggestedPriority)
      ? raw.suggestedPriority
      : null;
    // AI tags only fill in when the user hasn't tagged the idea themselves.
    const aiTags = Array.isArray(raw?.tags)
      ? normalizeTags(raw.tags.map((t: unknown) => String(t)))
      : [];

    const updated = await db.idea.update({
      where: { id: params.id },
      data: {
        complexity,
        impact,
        scope,
        aiEstimatedAt: new Date(),
        ...(idea.priority === "none" && suggested ? { priority: suggested } : {}),
        ...(idea.tags.length === 0 && aiTags.length ? { tags: aiTags } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Idea estimate error:", error);
    let messageText = "Failed to estimate idea";
    if (error instanceof Anthropic.APIError) messageText = `AI error: ${error.message}`;
    else if (error instanceof SyntaxError) messageText = "AI returned invalid data. Try re-estimating.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
