import { fenced, DATA_NOTICE } from "@/lib/ai-fence";
import { aiErrorMessage } from "@/lib/ai-errors";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { requireAiCall } from "@/lib/runs/http";
import { PLANNING_MODEL } from "@/lib/runs/policy";
import { normalizeTags } from "@/app/(app)/ideas/ideas-shared";
import { groundedContext } from "@/lib/project-grounding";
import { SIZE_GUIDE } from "@/lib/runs/size-guide";
import { correctionsBlock } from "@/lib/runs/owner-edits";

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const blocked = await requireAiCall(userId, session?.user?.email ?? null);
  if (blocked) return blocked;

  // `replaceEdited: true` is the owner saying "write a new scope even though I changed this one".
  const asked = (await request.json().catch(() => null)) as { replaceEdited?: unknown } | null;
  const replaceEdited = asked?.replaceEdited === true;
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

  const keepScope = !!idea.scopeEditedAt && !!idea.scope && !replaceEdited;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Estimating a feature's scope is a reasoning task, and it runs rarely (a
    // few calls when you add ideas), so it uses Claude Opus 5 — the strongest
    // reasoning model — rather than the cheaper Sonnet the high-volume photo
    // analysis uses. Opus 5 has adaptive thinking on by default; max_tokens
    // must leave room for that thinking plus the JSON answer.
    const message = await anthropic.messages.create({
      model: PLANNING_MODEL.estimate,
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `${await groundedContext(idea.project)}

${SIZE_GUIDE}

A feature idea to estimate (${DATA_NOTICE}):
Title: ${fenced("idea-title", idea.title)}
Notes:
${fenced("idea-notes", idea.notes || "(none)")}
${correctionsBlock(idea.corrections)}${keepScope ? `\nThe owner wrote this scope themselves. Size and value the idea from it; do not rewrite it, and in your "scope" field just repeat "kept":\n${fenced("owner-scope", idea.scope || "")}\n` : ""}
Size the work an AI coding agent would have to do to build this in ${idea.project.name}, and say how valuable it is. Return ONLY valid JSON, no other text:
{
  "complexity": "S | M | L | XL",
  "impact": "low | medium | high — how much this improves the product for its users (user value, differentiation, reach). Judge value, not effort.",
  "scope": "2-4 sentences: what the AI will change (files, models, endpoints, UI), the rough steps, and any real risk (sign-in, payments, schema, security) or dependency. Concrete and specific to this app. No hours or days. Only say that something does not exist, or must be built, if the inventory shows it is not there; if you cannot tell, say what you could not see and size the idea as if it may already exist.",
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
    const scope = keepScope ? undefined : typeof raw?.scope === "string" ? raw.scope.trim() : null;
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
        // An owner's own scope is kept unless they asked for a new one.
        ...(scope === undefined ? {} : { scope, scopeEditedAt: null }),
        aiEstimatedAt: new Date(),
        ...(idea.priority === "none" && suggested ? { priority: suggested } : {}),
        ...(idea.tags.length === 0 && aiTags.length ? { tags: aiTags } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Idea estimate error:", (error as Error)?.name);
    let messageText = "The estimate could not be made. Try again in a moment.";
    if (error instanceof SyntaxError) messageText = "AI returned invalid data. Try again.";
    else messageText = aiErrorMessage(error, messageText);
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
