import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { normalizeTags } from "@/app/(app)/ideas/ideas-shared";
import { projectPromptContext } from "@/lib/project-context";
import type { Idea as IdeaRecord } from "@/generated/prisma/client";

const COMPLEXITIES = ["S", "M", "L", "XL"];
const IMPACTS = ["low", "medium", "high"];

// Break a large idea into ordered child "stories" (each small enough for one
// coding-agent session), OR — when the idea is large for a human/external reason
// rather than code — flag it as a process and return a real-world checklist
// instead of fake code stories.
//
// POST body:
//   {}                          -> propose (calls the AI, saves nothing)
//   { commit: true, stories }   -> create the (possibly edited) stories as children
//   { commit: true, stories, replace: true } -> same, first deleting existing children

type StoryIn = {
  title?: unknown;
  notes?: unknown;
  complexity?: unknown;
  impact?: unknown;
  scope?: unknown;
};

function cleanStory(s: StoryIn) {
  const title = String(s?.title ?? "").trim();
  if (!title) return null;
  return {
    title: title.slice(0, 200),
    notes: s?.notes ? String(s.notes) : null,
    complexity: COMPLEXITIES.includes(s?.complexity as string) ? (s.complexity as string) : "M",
    impact: IMPACTS.includes(s?.impact as string) ? (s.impact as string) : null,
    scope: s?.scope ? String(s.scope) : null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await isOwner(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idea = await db.idea.findFirst({
    where: { id: params.id, userId },
    include: { project: true, _count: { select: { children: true } } },
  });
  if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  if (!idea.project) {
    return NextResponse.json({ error: "Idea has no project" }, { status: 400 });
  }
  if (idea.parentId) {
    return NextResponse.json(
      { error: "This is already a story inside an epic — break down its parent instead." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));

  // ---- Commit path: write the approved stories as children ----
  if (body?.commit) {
    const stories = (Array.isArray(body?.stories) ? (body.stories as StoryIn[]) : [])
      .map(cleanStory)
      .filter((s): s is NonNullable<ReturnType<typeof cleanStory>> => s !== null);
    if (stories.length === 0) {
      return NextResponse.json({ error: "No stories to create" }, { status: 400 });
    }
    if (idea._count.children > 0 && !body?.replace) {
      return NextResponse.json(
        { error: "This idea already has stories. Pass replace:true to regenerate.", existingChildren: idea._count.children },
        { status: 409 }
      );
    }

    // Replacing regenerates from scratch: drop the old children first.
    if (body?.replace && idea._count.children > 0) {
      await db.idea.deleteMany({ where: { parentId: idea.id, userId } });
    }

    const created: IdeaRecord[] = [];
    let prevId: string | null = null;
    for (const s of stories) {
      const row: IdeaRecord = await db.idea.create({
        data: {
          userId,
          projectId: idea.projectId,
          parentId: idea.id,
          title: s.title,
          notes: s.notes,
          status: "new",
          priority: "none",
          complexity: s.complexity,
          impact: s.impact,
          scope: s.scope,
          aiEstimatedAt: new Date(), // came pre-estimated from the breakdown
          // Each story is blocked by the previous one, encoding build order.
          blockedBy: prevId ? [prevId] : [],
        },
      });
      prevId = row.id;
      created.push(row);
    }

    // The idea is now an epic. If it was already marked done, reopen it — it
    // isn't done until its stories are.
    if (idea.status === "done") {
      await db.idea.update({ where: { id: idea.id }, data: { status: "building" } });
    }

    return NextResponse.json({ children: created }, { status: 201 });
  }

  // ---- Propose path: ask the AI, save nothing ----
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `${projectPromptContext(idea.project)}

You are splitting a large backlog idea for "${idea.project.name}" into a small number of ordered, independently shippable stories — each small enough for a single AI coding-agent session (prefer S or M effort; avoid L, never XL).

CRITICAL: First decide WHY this idea is large.
- If it is large because of the amount of CODE to build, return kind "stories": 3-8 stories in dependency/build order.
- If it is large because of a HUMAN or EXTERNAL process (paperwork, legal/compliance review, a partnership or API agreement, a manual data-gathering effort) rather than code, DO NOT invent code stories. Return kind "process" with a short reason and a real-world checklist of the actual steps a person must take.

The idea to break down:
Title: ${idea.title}
Notes: ${idea.notes || "(none)"}
AI scope estimate: ${idea.scope || "(not estimated)"}
Overall effort: ${idea.complexity || "?"} · value: ${idea.impact || "?"}

Return ONLY valid JSON, no other text:
{
  "kind": "stories" | "process",
  "summary": "1-2 sentences on how you split it (or why it can't be chunked as code).",
  "stories": [
    {
      "title": "imperative, specific (e.g. 'Add parentId to the Idea model')",
      "notes": "1-3 sentences: what this story delivers and the key files/models it touches.",
      "complexity": "S | M | L | XL",
      "impact": "low | medium | high",
      "scope": "1-2 sentences of concrete scope for this story."
    }
  ],
  "reason": "(only when kind is 'process') why this is human/external work, not code.",
  "checklist": ["(only when kind is 'process') real-world step", "..."]
}`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json({ error: "No breakdown generated" }, { status: 500 });
    }
    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const raw = JSON.parse(jsonStr);

    const kind = raw?.kind === "process" ? "process" : "stories";
    const summary = typeof raw?.summary === "string" ? raw.summary.trim() : "";

    if (kind === "process") {
      const checklist = Array.isArray(raw?.checklist)
        ? raw.checklist.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 20)
        : [];
      const reason = typeof raw?.reason === "string" ? raw.reason.trim() : "";
      return NextResponse.json({ kind, summary, reason, checklist, existingChildren: idea._count.children });
    }

    const stories = (Array.isArray(raw?.stories) ? raw.stories : [])
      .map(cleanStory)
      .filter((s: unknown): s is NonNullable<ReturnType<typeof cleanStory>> => !!s)
      .slice(0, 12)
      .map((s: NonNullable<ReturnType<typeof cleanStory>>) => ({
        ...s,
        // Seed 1-2 theme tags off the title so the created stories aren't bare.
        tags: normalizeTags(s.title.toLowerCase().split(/[^a-z0-9]+/)).slice(0, 2),
      }));

    if (stories.length === 0) {
      return NextResponse.json({ error: "The AI returned no stories. Try again." }, { status: 502 });
    }

    return NextResponse.json({ kind, summary, stories, existingChildren: idea._count.children });
  } catch (error: unknown) {
    console.error("Idea breakdown error:", error);
    let messageText = "Failed to break down idea";
    if (error instanceof Anthropic.APIError) messageText = `AI error: ${error.message}`;
    else if (error instanceof SyntaxError) messageText = "AI returned invalid data. Try again.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
