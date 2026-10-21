import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { canUse } from "@/lib/access";
import { normalizeTags } from "@/app/(app)/ideas/ideas-shared";
import { cleanKind, cleanSeverity } from "@/lib/issues";
import { cleanText } from "@/lib/support/sanitize";
import { CAPS, tooLong, firstProblem } from "@/lib/caps";

const STATUSES = ["new", "considering", "building", "done", "parked"];
const PRIORITIES = ["none", "low", "medium", "high"];
const IMPACTS = ["low", "medium", "high"];
const COMPLEXITIES = ["S", "M", "L", "XL"];

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const existing = await db.idea.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const data: {
      title?: string;
      notes?: string | null;
      status?: string;
      priority?: string;
      impact?: string;
      complexity?: string;
      tags?: string[];
      blockedBy?: string[];
      closureNote?: string | null;
      closedAt?: Date | null;
      kind?: string;
      severity?: string | null;
      repro?: string | null;
    } = {};
    const problem = firstProblem(
      tooLong("The title", typeof body?.title === "string" ? body.title.trim() : "", CAPS.title),
      tooLong("The notes", body?.notes === existing.notes ? undefined : body?.notes, CAPS.notes),
      tooLong("The closing note", body?.closureNote, CAPS.closureNote),
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (typeof body?.title === "string" && body.title.trim()) data.title = body.title.trim();
    if (body?.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
    if (STATUSES.includes(body?.status)) data.status = body.status;
    if (PRIORITIES.includes(body?.priority)) data.priority = body.priority;
    if (IMPACTS.includes(body?.impact)) data.impact = body.impact;
    if (COMPLEXITIES.includes(body?.complexity)) data.complexity = body.complexity;
    const kind = cleanKind(body?.kind);
    if (kind) {
      data.kind = kind;
      if (kind === "idea") { data.severity = null; data.repro = null; }
    }
    if ((data.kind ?? existing.kind) === "bug") {
      const sev = cleanSeverity(body?.severity);
      if (sev) data.severity = sev;
      else if (data.kind === "bug" && !existing.severity) data.severity = "medium";
      if (body?.repro !== undefined) data.repro = cleanText(body.repro, 4000) || null;
    }

    // Free-text closure note; empty/whitespace stores null.
    if (body?.closureNote !== undefined) {
      const t = typeof body.closureNote === "string" ? body.closureNote.trim() : "";
      data.closureNote = t || null;
    }
    // Stamp closedAt on the transition into done; clear it when leaving done.
    // (closureNote is left intact so the user's text survives a reopen.)
    if (data.status !== undefined) {
      if (data.status === "done" && existing.status !== "done") data.closedAt = new Date();
      else if (data.status !== "done" && existing.status === "done") data.closedAt = null;
    }

    if (Array.isArray(body?.tags)) {
      data.tags = normalizeTags(body.tags.slice(0, 50).map((t: unknown) => String(t)));
    }

    if (Array.isArray(body?.blockedBy)) {
      // Keep only real ideas owned by this user, never the idea itself.
      const rawIds = (body.blockedBy as unknown[]).slice(0, CAPS.blockedBy).map((x) => String(x));
      const wanted: string[] = Array.from(new Set(rawIds)).filter(
        (id) => id !== params.id
      );
      if (wanted.length === 0) {
        data.blockedBy = [];
      } else {
        const valid = await db.idea.findMany({
          where: { userId, id: { in: wanted } },
          select: { id: true },
        });
        data.blockedBy = valid.map((v) => v.id);
      }
    }

    const idea = await db.idea.update({ where: { id: params.id }, data });

    // Epic roll-up: if this idea is a story and its status changed, reconcile the
    // parent epic — done when every story is done, reopened if a story leaves done.
    if (existing.parentId && data.status !== undefined) {
      const siblings = await db.idea.findMany({
        where: { parentId: existing.parentId },
        select: { status: true },
      });
      const allDone = siblings.length > 0 && siblings.every((s) => s.status === "done");
      const parent = await db.idea.findFirst({
        where: { id: existing.parentId, userId },
        select: { status: true },
      });
      if (parent) {
        if (allDone && parent.status !== "done") {
          await db.idea.update({
            where: { id: existing.parentId },
            data: { status: "done", closedAt: new Date() },
          });
        } else if (!allDone && parent.status === "done") {
          await db.idea.update({
            where: { id: existing.parentId },
            data: { status: "building", closedAt: null },
          });
        }
      }
    }

    return NextResponse.json(idea);
  } catch (error) {
    logError("Update idea error:", error);
    return NextResponse.json({ error: "Could not update the idea. Try again in a moment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId || !(await canUse(userId, session?.user?.email))) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const existing = await db.idea.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }

  await db.idea.delete({ where: { id: params.id } });
  return NextResponse.json({ message: "Idea deleted" });
}
