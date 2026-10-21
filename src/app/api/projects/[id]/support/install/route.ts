import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { errorResponse } from "@/lib/runs/http";
import { installSupport } from "@/lib/support/install";
import { baseUrl } from "@/lib/support/email";

// Owner: "Add it for me". Starts an Idea HQ run that adds the Help button to the
// project's own repo as a pull request.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const project = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const space = await db.supportSpace.findUnique({ where: { projectId: project.id }, select: { publicKey: true } });
  if (!space) return NextResponse.json({ error: "Turn on support for this project first." }, { status: 400 });
  try {
    const origin = baseUrl();
    const snippet = `<script src="${origin}/embed/${space.publicKey}.js" defer></script>`;
    const result = await installSupport(auth.userId, project.id, snippet, space.publicKey, origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
