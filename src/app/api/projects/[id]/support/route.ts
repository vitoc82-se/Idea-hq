import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTickets } from "@/lib/support/owner";
import { cleanSettings, SPACE_DEFAULTS } from "@/lib/support/settings";
import { newPublicKey } from "@/lib/support/tokens";
import { parseNotes } from "@/lib/support/notes";
import { parseFormDef } from "@/lib/support/form-schema";
import { errorResponse } from "@/lib/runs/http";
import { baseUrl } from "@/lib/support/email";
import { installStatus } from "@/lib/support/install";

type SpaceRow = {
  publicKey: string; enabled: boolean; title: string; brandColor: string; logoUrl: string | null; theme: string; allowedOrigins: string[];
  formSchema: unknown; aiEnabled: boolean; aiDailyCap: number; retentionDays: number; notifyEmail: string | null; replyTimeNote: string | null;
  supportKnowledge: unknown;
};

function dto(s: SpaceRow) {
  return {
    key: s.publicKey, enabled: s.enabled, title: s.title, brandColor: s.brandColor, logoUrl: s.logoUrl, theme: s.theme,
    allowedOrigins: s.allowedOrigins, formSchema: parseFormDef(s.formSchema), aiEnabled: s.aiEnabled, aiDailyCap: s.aiDailyCap,
    retentionDays: s.retentionDays, notifyEmail: s.notifyEmail, replyTimeNote: s.replyTimeNote, notes: parseNotes(s.supportKnowledge),
    baseUrl: baseUrl(),
    aiSwitchOn: process.env.SUPPORT_AI_ENABLED === "1",
  };
}

// Owner: read this project's support settings (null until support is first turned on).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const project = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, name: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const space = (await db.supportSpace.findUnique({ where: { projectId: project.id } })) as SpaceRow | null;
  const p = await db.project.findFirst({ where: { id: project.id, userId: auth.userId }, select: { repoOwner: true, repoName: true, workflowInstalled: true, secretConfirmed: true } });
  const aiReady = !!(p?.repoOwner && p.repoName && p.workflowInstalled && p.secretConfirmed);
  const install = aiReady ? await installStatus(auth.userId, project.id) : null;
  return NextResponse.json({ project, space: space ? dto(space) : null, aiReady, install });
}

// Owner: create or update the settings.
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireTickets();
  if ("res" in auth) return auth.res;
  const project = await db.project.findFirst({ where: { id: params.id, userId: auth.userId }, select: { id: true, name: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const checked = cleanSettings(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const patch = checked.patch as Record<string, unknown>;
    const existing = await db.supportSpace.findUnique({ where: { projectId: project.id }, select: { id: true } });
    const space = existing
      ? await db.supportSpace.update({ where: { projectId: project.id }, data: patch })
      : await db.supportSpace.create({
          data: { ...SPACE_DEFAULTS, title: project.name.slice(0, 60), publicKey: newPublicKey(), projectId: project.id, ...patch },
        });
    return NextResponse.json({ space: dto(space as SpaceRow) });
  } catch (e) {
    return errorResponse(e);
  }
}
