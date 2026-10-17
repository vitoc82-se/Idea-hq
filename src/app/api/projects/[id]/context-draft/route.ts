import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse, consumeAiCall } from "@/lib/access";
import { github } from "@/lib/github/client";
import { snapshotRepo, buildContextPrompt } from "@/lib/context-draft";

// Drafts the project's context from its connected repo. Returns text only; the
// user edits it and saves it through the normal project update.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const p = await db.project.findFirst({ where: { id: params.id, userId } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!p.installationId || !p.repoOwner || !p.repoName) {
    return NextResponse.json({ error: "Connect a GitHub repo to this project first." }, { status: 409 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured (ANTHROPIC_API_KEY missing)." }, { status: 503 });
  }
  if (!(await consumeAiCall(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Daily AI limit reached. Try again tomorrow." }, { status: 429 });
  }
  try {
    const map = (p.envBranches || {}) as Record<string, string>;
    const ref = map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
    const snap = await snapshotRepo(github, p.installationId, p.repoOwner, p.repoName, ref);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 2500,
      messages: [{ role: "user", content: buildContextPrompt(p.name, snap) }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!text) return NextResponse.json({ error: "The AI returned nothing. Try again." }, { status: 502 });
    return NextResponse.json({ context: text });
  } catch (e) {
    console.error("context draft error", e);
    return NextResponse.json({ error: "Could not draft the context. Try again." }, { status: 500 });
  }
}
