import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { checkSite } from "@/lib/support/site-check";
import { firstExceeded } from "@/lib/support/ratelimit";
import { rateStore } from "@/lib/support/public-store";
import { hashIdent } from "@/lib/support/tokens";

// Owner: "Check my site". Looks for the embed code on a page of the owner's site.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const project = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const space = await db.supportSpace.findUnique({ where: { projectId: project.id }, select: { publicKey: true, allowedOrigins: true } });
  if (!space) return NextResponse.json({ error: "Turn on support for this project first." }, { status: 400 });
  // The check makes a web request from our servers, so it is rationed per person.
  if (await firstExceeded(rateStore, [{ key: `sitecheck:user:${hashIdent(auth.userId)}`, limit: 20, windowSec: 3600 }])) {
    return NextResponse.json({ status: "limited" });
  }
  const body = await request.json().catch(() => null);
  const result = await checkSite(body?.url, space.publicKey, space.allowedOrigins);
  return NextResponse.json(result);
}
