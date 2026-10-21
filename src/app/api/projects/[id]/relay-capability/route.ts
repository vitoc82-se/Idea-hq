import { repoAccessProblem } from "@/lib/github/access";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installationSecretsAccess } from "@/lib/github/client";
import { requireUser } from "@/lib/runs/http";

// Can Idea HQ save an API key into this project's repo for the user? Only when the project
// is connected to a repo and its GitHub installation has "Secrets: write". `reason` says
// which part is missing, so the setup page can tell the person exactly what to do.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { userId: true, installationId: true, repoOwner: true, repoName: true } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!p.installationId || !p.repoOwner || !p.repoName) return NextResponse.json({ canWrite: false, reason: "no_repo" });
  const noAccess = await repoAccessProblem(p);
  if (noAccess) return NextResponse.json({ error: noAccess }, { status: 403 });
  const access = await installationSecretsAccess(p.installationId);
  if (access === "write") return NextResponse.json({ canWrite: true, reason: null });
  return NextResponse.json({ canWrite: false, reason: access === "error" ? "check_failed" : "permission" });
}
