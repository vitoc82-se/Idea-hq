import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse, consumeAiCall } from "@/lib/access";
import { planModel } from "@/lib/runs/policy";
import { projectPromptContext } from "@/lib/project-context";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await consumeAiCall(userId, session?.user?.email))) {
    return NextResponse.json(
      { error: "Daily AI limit reached. Try again tomorrow." },
      { status: 429 }
    );
  }

  const idea = await db.idea.findFirst({
    where: { id: params.id, userId },
    include: {
      project: true,
      children: {
        select: { title: true, complexity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }
  if (!idea.project) {
    return NextResponse.json(
      { error: "Idea has no project to build against." },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  // Resolve any dependency titles so the plan can reference them.
  let blockedByTitles: string[] = [];
  if (idea.blockedBy.length) {
    const deps = await db.idea.findMany({
      where: { userId, id: { in: idea.blockedBy } },
      select: { title: true, status: true },
    });
    blockedByTitles = deps
      .filter((d) => d.status !== "done")
      .map((d) => d.title);
  }

  // If this idea is an epic (already split into stories), the build prompt becomes
  // a sequencing/overview doc — each story carries its own detailed prompt.
  const epicNote = idea.children.length
    ? `\n\nThis idea is an EPIC, already broken into these ordered stories:\n${idea.children
        .map((c, i) => `${i + 1}. ${c.title}${c.complexity ? ` (${c.complexity})` : ""}`)
        .join("\n")}\nEach story has its own detailed build prompt. So do NOT re-specify each story. Instead produce a concise SEQUENCING / OVERVIEW: the order to build them, any shared groundwork (schema, types, shared helpers) to land first, integration + test checkpoints between stories, and what "epic done" looks like.`
    : "";

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Each project here is built by an AI coding agent — so "promote to plan"
    // produces a ready-to-paste BUILD PROMPT addressed to that agent, grounded in
    // the project's own context. Reasoning task run on demand, so it uses Claude
    // Opus 5 with room for adaptive thinking.
    const message = await anthropic.messages.create({
      model: planModel(idea.complexity),
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `You write build prompts for an AI coding agent (Claude Code) that has full read/write access to the "${idea.project.name}" repo. No human writes code — the agent implements the whole feature and ships it. Your job: turn the backlog idea below into ONE self-contained prompt the owner can paste straight into the agent with no edits.

${projectPromptContext(idea.project)}

Follow the stack conventions, access-control, schema/migration rules and deploy flow described in the project context above — they differ per project, so do not assume any specific framework or deploy command that the context does not state. Prefer a feature branch, verify a build/typecheck before shipping, and keep data-model changes safe for that project's deploy process.

The idea to build:
Title: ${idea.title}
Notes: ${idea.notes || "(none)"}
AI scope estimate: ${idea.scope || "(not estimated)"}
Effort: ${idea.complexity || "?"} · Value: ${idea.impact || "?"}
${blockedByTitles.length ? `Depends on (build these first): ${blockedByTitles.join(", ")}` : ""}${epicNote}

Write the prompt in Markdown, addressed directly to the agent in the imperative ("Add…", "Create…", "Update…"). Structure it as:

# <short feature name>
**Goal:** one or two sentences on the user-facing outcome.

## Verify first
Tell the agent to confirm the assumptions below against the actual code before writing anything, and to adapt if reality differs from the architecture doc (the doc can lag). Name the specific files/routes/models it should open to check (e.g. the relevant API route, the Prisma model, the page/component it will touch).

## Context
The few repo specifics that matter for THIS feature — which existing files/models/routes it builds on. Prefer extending what already exists over adding parallel systems; if a route or helper for this already exists, say so and reuse it.

## Implementation
A numbered, ordered list of concrete steps naming the exact files, Prisma models, API routes and components to add or change. Be specific to this codebase — no generic filler.

## Data & deploy notes
Any schema change and why it's db-push-safe (or flag the risk). Note the prisma generate + build + branch/merge/push steps to follow.

## Acceptance criteria
A checkbox list ("- [ ] …") of what "done" looks like, including that tsc and the build pass.

Rules: be concrete and specific to ${idea.project.name} and grounded in the project context above; do not invent files or endpoints that aren't in it, and never propose building something it says already exists. Prefer the smallest change that fully delivers the idea; if something is genuinely ambiguous, state a sensible default and proceed rather than asking. Output ONLY the prompt Markdown, no preamble or sign-off.`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json({ error: "No build prompt generated" }, { status: 500 });
    }
    const plan = textContent.text.trim();

    const updated = await db.idea.update({
      where: { id: params.id },
      data: { plan, plannedAt: new Date() },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error("Idea plan error:", error);
    let messageText = "Failed to generate build prompt";
    if (error instanceof Anthropic.APIError) messageText = `AI error: ${error.message}`;
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
