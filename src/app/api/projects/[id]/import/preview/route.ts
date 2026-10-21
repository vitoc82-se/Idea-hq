import { repoAccessProblem } from "@/lib/github/access";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { github } from "@/lib/github/client";
import { requireUser, requireAi, errorResponse } from "@/lib/runs/http";
import { PLANNING_MODEL } from "@/lib/runs/policy";
import { buildImportPrompt, parseImportItems, findBacklogFiles, MAX_SOURCE_CHARS } from "@/lib/backlog-import";

// Reads a backlog (a file in the repo, or pasted text) and lists the ideas in it.
// Nothing is saved here: the owner ticks what to import first.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const body = await request.json().catch(() => null);

  let text = "";
  let label = "pasted text";
  if (typeof body?.path === "string" && body.path) {
    if (!p.installationId || !p.repoOwner || !p.repoName) return NextResponse.json({ error: "Connect a GitHub repo to this project first." }, { status: 409 });
    const noAccess = await repoAccessProblem(p);
    if (noAccess) return NextResponse.json({ error: noAccess }, { status: 403 });
    const map = (p.envBranches || {}) as Record<string, string>;
    const ref = map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
    try {
      // Only files the repo scan would offer, so this cannot be used to read arbitrary paths.
      const tree = await github.listTree(p.installationId, p.repoOwner, p.repoName, ref);
      if (!findBacklogFiles(tree.paths, 50).includes(body.path)) return NextResponse.json({ error: "That file is not on the list of backlog files." }, { status: 400 });
      const f = await github.getFile(p.installationId, p.repoOwner, p.repoName, body.path, ref);
      if (!f) return NextResponse.json({ error: "Could not read that file." }, { status: 404 });
      text = f.content;
      label = body.path;
    } catch (e) {
      return errorResponse(e);
    }
  } else if (typeof body?.text === "string") {
    text = body.text.slice(0, 300_000);
  }
  if (text.trim().length < 3) return NextResponse.json({ error: "There is no text to read. Paste your list or pick a file." }, { status: 400 });

  const blocked = await requireAi(auth.userId, auth.email);
  if (blocked) return blocked;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: PLANNING_MODEL.context,
      max_tokens: 6000,
      messages: [{ role: "user", content: buildImportPrompt(p.name, label, text) }],
    });
    const out = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const items = parseImportItems(out);
    if (!items.length) return NextResponse.json({ error: "The AI could not find any ideas in that text. Check that it is a list of ideas or tasks." }, { status: 422 });
    return NextResponse.json({ items, source: label, truncated: text.length > MAX_SOURCE_CHARS });
  } catch (e) {
    return errorResponse(e);
  }
}
