import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { github } from "@/lib/github/client";
import { snapshotRepo } from "@/lib/repo-snapshot";
import { draftSections } from "@/lib/context-draft";
import { PLANNING_MODEL } from "@/lib/runs/policy";
import { mergeAiSections, completeness, SECTION_DEFS } from "@/lib/knowledge";
import { loadKnowledge, saveKnowledge } from "@/lib/knowledge-store";
import { requireUser, requireAi, errorResponse } from "@/lib/runs/http";

// Quick draft: reads the repo (full file list, the files that explain it) and
// fills the knowledge sections. Never overwrites what the owner wrote or
// confirmed, unless `force` is sent. Saved straight away so the AI can use it.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const loaded = await loadKnowledge(auth.userId, params.id);
  if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const p = loaded.project;
  if (!p.installationId || !p.repoOwner || !p.repoName) {
    return NextResponse.json({ error: "Connect a GitHub repo to this project first." }, { status: 409 });
  }
  const blocked = await requireAi(auth.userId, auth.email);
  if (blocked) return blocked;
  try {
    const body = await request.json().catch(() => ({}));
    const map = (p.envBranches || {}) as Record<string, string>;
    const ref = map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
    const snap = await snapshotRepo(github, p.installationId, p.repoOwner, p.repoName, ref);
    if (!snap.files.length) {
      return NextResponse.json({ error: "Could not read any files from the repo. Check the branch name and that the app can see the repo." }, { status: 422 });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const sections = await draftSections(anthropic, PLANNING_MODEL.context, p.name, snap);
    if (!Object.keys(sections).length) return NextResponse.json({ error: "The AI could not describe the project from what it found. Try again, or fill the sections in by hand." }, { status: 502 });

    const head = await github.repoBranch(p.installationId, p.repoOwner, p.repoName, ref).catch(() => null);
    let k = mergeAiSections(loaded.knowledge, sections, "quick-draft", { force: !!body?.force });
    k = { ...k, learnedSha: head?.sha ?? k.learnedSha, learnedAt: new Date().toISOString() };
    const saved = await saveKnowledge(auth.userId, p.id, k);
    await db.project.update({ where: { id: p.id }, data: { knowledgeBehind: 0, freshnessCheckedAt: new Date() } }).catch(() => undefined);
    return NextResponse.json({
      context: saved?.context ?? "",
      sections: SECTION_DEFS.map((d) => ({ id: d.id, text: k.sections[d.id]?.text ?? "" })),
      completeness: completeness(k),
      read: { files: snap.files.map((f) => f.path), ecosystems: snap.ecosystems },
    });
  } catch (e) {
    console.error("knowledge draft error", e);
    return errorResponse(e);
  }
}
