import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { github } from "@/lib/github/client";
import { requireUser, errorResponse } from "@/lib/runs/http";
import { cleanImportRequest, findBacklogFiles, withoutExisting } from "@/lib/backlog-import";

const refOf = (p: { envBranches: unknown; defaultEnv: string | null }) => {
  const map = (p.envBranches || {}) as Record<string, string>;
  return map[p.defaultEnv || ""] || Object.values(map)[0] || "main";
};

// Files in the connected repo that look like a backlog (TODO.md and friends).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!p.installationId || !p.repoOwner || !p.repoName) return NextResponse.json({ repoConnected: false, files: [] });
  try {
    const tree = await github.listTree(p.installationId, p.repoOwner, p.repoName, refOf(p));
    return NextResponse.json({ repoConnected: true, repo: `${p.repoOwner}/${p.repoName}`, files: findBacklogFiles(tree.paths) });
  } catch {
    return NextResponse.json({ repoConnected: true, repo: `${p.repoOwner}/${p.repoName}`, files: [], note: "Could not look in the repo right now." });
  }
}

// Creates the ideas the owner ticked. Skips titles the project already has.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const items = cleanImportRequest(body?.items);
  if (!items) return NextResponse.json({ error: "Pick at least one idea to import (up to 100)." }, { status: 400 });
  const source = typeof body?.source === "string" ? body.source.replace(/[^\w./ -]/g, "").slice(0, 80) : "";
  try {
    const existing = await db.idea.findMany({ where: { projectId: p.id, userId: auth.userId }, select: { title: true } });
    const { fresh, skipped } = withoutExisting(items, existing.map((e: { title: string }) => e.title));
    if (fresh.length) {
      await db.idea.createMany({
        data: fresh.map((it) => ({
          userId: auth.userId, projectId: p.id, title: it.title, status: it.done ? "done" : "new",
          notes: [it.notes, source ? `Imported from ${source}` : "Imported"].filter(Boolean).join("\n\n"),
          ...(it.done ? { closedAt: new Date(), closureNote: "Already finished when imported." } : {}),
        })),
      });
    }
    return NextResponse.json({ created: fresh.length, skipped });
  } catch (e) {
    return errorResponse(e);
  }
}
