import { repoAccessProblem } from "@/lib/github/access";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { github } from "@/lib/github/client";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { reconcileRun } from "@/lib/runs/engine";
import { buildAccess } from "@/lib/billing";
import { capState, capMessage } from "@/lib/spend";
import { isStale } from "@/lib/freshness";
import { loadKnowledge, saveKnowledge } from "@/lib/knowledge-store";
import { SECTION_DEFS, acceptProposal, completeness, confirmAll, dismissProposal, isSectionId, knowledgeNotice, pendingProposals, setSection, type SectionId } from "@/lib/knowledge";

// Everything the Project knowledge page shows.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const loaded = await loadKnowledge(auth.userId, params.id);
    if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const { project: p, knowledge: k, memory } = loaded;
    const hasRepo = !!(p.installationId && p.repoOwner && p.repoName) && !(await repoAccessProblem(p));

    // How far the repo has moved since the knowledge was learned (one cached request).
    let behind: number | null = null;
    if (hasRepo && k.learnedSha) {
      const map = (p.envBranches || {}) as Record<string, string>;
      const ref = map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
      behind = await github.commitsAhead(p.installationId!, p.repoOwner!, p.repoName!, k.learnedSha, ref).catch(() => null);
      if (behind !== null) await db.project.update({ where: { id: p.id }, data: { knowledgeBehind: behind, freshnessCheckedAt: new Date() } }).catch(() => undefined);
    }
    // Forget the export PR once it is merged or closed.
    let exportPr = p.knowledgePrNumber;
    if (exportPr && hasRepo) {
      const pr = await github.getPr(p.installationId!, p.repoOwner!, p.repoName!, exportPr).catch(() => null);
      if (pr && pr.state !== "open") {
        exportPr = null;
        await db.project.update({ where: { id: p.id }, data: { knowledgePrNumber: null } });
      }
    }
    let learn = await db.run.findFirst({ where: { projectId: p.id, userId: auth.userId, kind: "learn" }, orderBy: { createdAt: "desc" } });
    if (learn && ["dispatched", "running", "pr_open"].includes(learn.status)) {
      await reconcileRun(learn.id).catch(() => undefined); // repairs missed webhooks (30s cooldown)
      learn = (await db.run.findFirst({ where: { id: learn.id, userId: auth.userId } })) ?? learn;
    }
    const access = await buildAccess(auth.userId);
    return NextResponse.json({
      projectName: p.name,
      aiBuild: access.ok || access.reason !== "off",
      needsPlan: !access.ok && access.reason === "needs_plan",
      capReached: await capState(p.id).then((c) => (c.reached ? capMessage(p.name, c) : null)),
      repo: hasRepo ? { owner: p.repoOwner, name: p.repoName } : null,
      workflowInstalled: p.workflowInstalled,
      sections: SECTION_DEFS.map((d) => ({ id: d.id, title: d.title, hint: d.hint, core: d.core, ...(k.sections[d.id] ?? { text: "", source: null, status: null, updatedAt: null }), proposal: k.proposals?.[d.id] ?? null })),
      completeness: completeness(k),
      freshness: { learnedAt: k.learnedAt ?? null, behind, stale: isStale(behind), proposals: pendingProposals(k).length, notice: knowledgeNotice({ proposals: pendingProposals(k).length, behind, learnedAt: k.learnedAt }) },
      memory: memory.map((m) => ({ id: m.id, kind: m.kind, text: m.text, pinned: m.pinned, source: m.source, createdAt: m.createdAt })),
      learnRun: learn
        ? { id: learn.id, status: learn.status, prNumber: learn.prNumber, checksState: learn.checksState, costUsd: learn.costUsd, error: learn.error, createdAt: learn.createdAt }
        : null,
      exportPr,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// Edit one section (an edit counts as confirming it), confirm one, confirm all, or settle a scan's suggestion for a topic
// (`useSuggestion`: take the scan's text; `keepMine`: keep the owner's text and do not offer the same suggestion again).
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  try {
    const loaded = await loadKnowledge(auth.userId, params.id);
    if (!loaded) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const b = await request.json().catch(() => null);
    if (!b) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    let k = loaded.knowledge;
    if (b.confirmAll === true) {
      k = confirmAll(k);
    } else if (isSectionId(b.section)) {
      const sid: SectionId = b.section;
      const cur = k.sections[sid];
      if (b.useSuggestion === true || b.keepMine === true) {
        if (!k.proposals?.[sid]) return NextResponse.json({ error: "There is no suggestion for this topic any more." }, { status: 409 });
        k = b.useSuggestion === true ? acceptProposal(k, sid) : dismissProposal(k, sid);
      } else if (typeof b.text === "string") k = setSection(k, sid, b.text, "you", "confirmed");
      else if (b.confirm === true && cur) k = setSection(k, sid, cur.text, cur.source, "confirmed");
      else return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "Unknown section" }, { status: 400 });
    }
    await saveKnowledge(auth.userId, params.id, k);
    return NextResponse.json({ ok: true, completeness: completeness(k) });
  } catch (e) {
    return errorResponse(e);
  }
}
