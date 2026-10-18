import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { installationCanWriteSecrets } from "@/lib/github/client";
import { requireUser } from "@/lib/runs/http";

// Can Idea HQ save an API key into this project's repo for the user? Only once
// the GitHub App's "Secrets: write" permission has been approved for the install.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("res" in auth) return auth.res;
  const p = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { installationId: true } });
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const canWrite = p.installationId ? await installationCanWriteSecrets(p.installationId) : false;
  return NextResponse.json({ canWrite });
}
