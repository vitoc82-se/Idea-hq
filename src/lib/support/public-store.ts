import { db } from "@/lib/db";
import { TICKETS_FEATURE, type TicketStatus } from "./constants";
import { parseFormDef, type FormDef } from "./form-schema";
import { confirmedNotes, type Note } from "./notes";
import { hashToken, isKeyShape, isTokenShape, safeEqualHex, deriveTicketToken, newTicketId } from "./tokens";
import type { RateStore } from "./ratelimit";

// The ONLY door between the public support surface and the database. Public
// routes (widget, ticket page, /api/support/*) may import this module and the
// pure helpers beside it, and nothing else that touches data. It reads and
// writes only the support tables, never project internals, runs or repo access.

export type PublicSpace = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  brandColor: string;
  logoUrl: string | null;
  theme: string;
  allowedOrigins: string[];
  form: FormDef;
  aiEnabled: boolean;
  aiDailyCap: number;
  retentionDays: number;
  replyTimeNote: string | null;
  notifyEmail: string | null;
  ownerEmail: string | null;
  projectName: string;
  notes: Note[]; // confirmed help notes only
};

function ownerAllowed(user: { features?: string[] | null; email?: string | null } | null): boolean {
  if (!user) return false;
  if (user.features?.includes(TICKETS_FEATURE)) return true;
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return !!owner && !!user.email && user.email.trim().toLowerCase() === owner;
}

const SPACE_SELECT = {
  id: true, projectId: true, enabled: true, publicKey: true, allowedOrigins: true, title: true, brandColor: true,
  logoUrl: true, theme: true, formSchema: true, aiEnabled: true, aiDailyCap: true, retentionDays: true,
  replyTimeNote: true, notifyEmail: true, supportKnowledge: true,
  project: { select: { name: true, user: { select: { features: true, email: true, aiDailyLimit: true } } } },
} as const;

type SpaceRow = {
  id: string; projectId: string; enabled: boolean; publicKey: string; allowedOrigins: string[]; title: string; brandColor: string;
  logoUrl: string | null; theme: string; formSchema: unknown; aiEnabled: boolean; aiDailyCap: number; retentionDays: number;
  replyTimeNote: string | null; notifyEmail: string | null; supportKnowledge: unknown;
  project: { name: string; user: { features: string[]; email: string | null; aiDailyLimit?: number | null } };
};

function toPublic(s: SpaceRow): PublicSpace | null {
  // The feature gate runs on every public request: the owner must hold the
  // "tickets" feature AND the project must have support switched on.
  if (!s.enabled || !ownerAllowed(s.project.user)) return null;
  return {
    id: s.id, projectId: s.projectId, key: s.publicKey, title: s.title, brandColor: s.brandColor, logoUrl: s.logoUrl,
    theme: s.theme, allowedOrigins: s.allowedOrigins, form: parseFormDef(s.formSchema),
    // The owner's helper limit of 0 switches off every AI call paid by the owner's key, Support answers included.
    aiEnabled: s.aiEnabled && s.project.user.aiDailyLimit !== 0,
    aiDailyCap: s.aiDailyCap, retentionDays: s.retentionDays, replyTimeNote: s.replyTimeNote, notifyEmail: s.notifyEmail,
    ownerEmail: s.project.user.email, projectName: s.project.name, notes: confirmedNotes(s.supportKnowledge),
  };
}

export async function loadPublicSpace(key: unknown): Promise<PublicSpace | null> {
  if (!isKeyShape(key)) return null;
  const row = (await db.supportSpace.findUnique({ where: { publicKey: key }, select: SPACE_SELECT })) as SpaceRow | null;
  return row ? toPublic(row) : null;
}

export const rateStore: RateStore = {
  async hit(key, windowSec) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowSec * 1000);
    const nowIso = now.toISOString();
    const cutIso = cutoff.toISOString();
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateBucket" ("key", "windowStart", "count")
      VALUES (${key}, ${nowIso}::timestamp, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateBucket"."windowStart" < ${cutIso}::timestamp THEN 1 ELSE "RateBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateBucket"."windowStart" < ${cutIso}::timestamp THEN ${nowIso}::timestamp ELSE "RateBucket"."windowStart" END
      RETURNING "count"`;
    return Number(rows[0]?.count ?? 1);
  },
};

export type NewTicket = {
  space: PublicSpace;
  email: string;
  name: string | null;
  subject: string;
  message: string;
  fields: { id: string; label: string; value: string }[];
  aiAnswer?: { question: string; answer: string } | null;
};

export async function createTicket(t: NewTicket): Promise<{ number: number; token: string }> {
  const id = newTicketId();
  const token = deriveTicketToken(id);
  const number = await db.$transaction(async (tx) => {
    const counter = await tx.supportSpace.update({
      where: { id: t.space.id },
      data: { ticketCounter: { increment: 1 } },
      select: { ticketCounter: true },
    });
    const messages: { author: string; body: string; aiMeta?: object }[] = [];
    if (t.aiAnswer) {
      messages.push({ author: "customer", body: t.aiAnswer.question });
      messages.push({ author: "ai", body: t.aiAnswer.answer, aiMeta: { source: "help_notes" } });
    }
    messages.push({ author: "customer", body: t.message });
    await tx.ticket.create({
      data: {
        id,
        projectId: t.space.projectId,
        number: counter.ticketCounter,
        status: "open",
        subject: t.subject,
        customerEmail: t.email,
        customerName: t.name,
        fields: t.fields,
        needsHuman: true,
        aiAnswered: !!t.aiAnswer,
        unread: true,
        tokenHash: hashToken(token),
        messages: { create: messages },
      },
    });
    return counter.ticketCounter;
  });
  return { number, token };
}

export type PublicTicket = {
  id: string;
  number: number;
  status: TicketStatus;
  subject: string;
  customerEmail: string;
  messages: { author: "customer" | "owner" | "ai"; body: string; createdAt: string }[];
  space: PublicSpace;
};

export async function loadTicketByToken(token: unknown): Promise<PublicTicket | null> {
  if (!isTokenShape(token)) return null;
  const hash = hashToken(token);
  const row = await db.ticket.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true, number: true, status: true, subject: true, customerEmail: true, tokenHash: true,
      messages: { orderBy: { createdAt: "asc" }, select: { author: true, body: true, createdAt: true } },
      project: { select: { support: { select: SPACE_SELECT } } },
    },
  });
  if (!row || !safeEqualHex(row.tokenHash, hash)) return null;
  const sp = row.project.support as SpaceRow | null;
  const space = sp ? toPublic(sp) : null;
  if (!space) return null;
  return {
    id: row.id,
    number: row.number,
    status: row.status as TicketStatus,
    subject: row.subject,
    customerEmail: row.customerEmail,
    messages: row.messages.map((m: { author: string; body: string; createdAt: Date }) => ({
      author: m.author === "owner" || m.author === "ai" ? m.author : "customer",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    space,
  };
}

// A customer reply. Refuses closed tickets; reopens resolved ones.
export async function addCustomerMessage(ticketId: string, body: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const t = await tx.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
    if (!t || t.status === "closed") return false;
    await tx.ticketMessage.create({ data: { ticketId, author: "customer", body } });
    await tx.ticket.update({
      where: { id: ticketId },
      data: { status: "open", needsHuman: true, unread: true, lastActivityAt: new Date(), closedAt: null },
    });
    return true;
  });
}
