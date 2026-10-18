import { z } from "zod";
import { LIMITS, DEFAULT_BRAND } from "./constants";
import { formSchema } from "./form-schema";
import { cleanText, normalizeEmail, normalizeOrigin, safeHttpsUrl } from "./sanitize";
import { isHexColor } from "./contrast";
import { parseNotes, type Note } from "./notes";

// Owner-editable support settings. Strict: unknown keys are rejected.

const noteSchema = z
  .object({
    id: z.string().max(40).optional(),
    title: z.string().max(LIMITS.noteTitleMax),
    text: z.string().max(LIMITS.noteTextMax),
    status: z.enum(["needs_review", "confirmed"]),
  })
  .strict();

export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string().trim().min(1).max(LIMITS.titleMax),
    brandColor: z.string(),
    logoUrl: z.string().max(500).nullable(),
    theme: z.enum(["auto", "light", "dark"]),
    allowedOrigins: z.array(z.string()).max(LIMITS.maxOrigins),
    formSchema: formSchema,
    aiEnabled: z.boolean(),
    aiDailyCap: z.number().int().min(0).max(LIMITS.aiCapMax),
    retentionDays: z.number().int().min(LIMITS.retentionMinDays).max(LIMITS.retentionMaxDays),
    notifyEmail: z.string().max(254).nullable(),
    replyTimeNote: z.string().max(LIMITS.replyTimeMax).nullable(),
    notes: z.array(noteSchema).max(LIMITS.maxNotes),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsSchema>;

export type CleanPatch = {
  enabled?: boolean;
  title?: string;
  brandColor?: string;
  logoUrl?: string | null;
  theme?: string;
  allowedOrigins?: string[];
  formSchema?: object;
  aiEnabled?: boolean;
  aiDailyCap?: number;
  retentionDays?: number;
  notifyEmail?: string | null;
  replyTimeNote?: string | null;
  supportKnowledge?: { notes: Note[] };
};

// Validates and normalises a settings update. Returns a database-ready patch or a message.
export function cleanSettings(raw: unknown): { ok: true; patch: CleanPatch } | { ok: false; error: string } {
  const r = settingsSchema.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: i ? `${i.path.join(".") || "settings"}: ${i.message}` : "Invalid settings" };
  }
  const v = r.data;
  const patch: CleanPatch = {};
  if (v.enabled !== undefined) patch.enabled = v.enabled;
  if (v.title !== undefined) patch.title = cleanText(v.title, LIMITS.titleMax) || "Support";
  if (v.brandColor !== undefined) {
    if (!isHexColor(v.brandColor)) return { ok: false, error: "brandColor: use a colour like #047857" };
    patch.brandColor = v.brandColor.trim().toLowerCase();
  }
  if (v.logoUrl !== undefined) {
    if (v.logoUrl === null || v.logoUrl.trim() === "") patch.logoUrl = null;
    else {
      const u = safeHttpsUrl(v.logoUrl);
      if (!u) return { ok: false, error: "logoUrl: use a full https:// address" };
      patch.logoUrl = u;
    }
  }
  if (v.theme !== undefined) patch.theme = v.theme;
  if (v.allowedOrigins !== undefined) {
    const out: string[] = [];
    for (const o of v.allowedOrigins) {
      if (!o.trim()) continue;
      const n = normalizeOrigin(o);
      if (!n) return { ok: false, error: `allowedOrigins: "${o.slice(0, 60)}" is not a valid site address (use https://yourdomain.com)` };
      if (!out.includes(n)) out.push(n);
    }
    patch.allowedOrigins = out;
  }
  if (v.formSchema !== undefined) patch.formSchema = v.formSchema;
  if (v.aiEnabled !== undefined) patch.aiEnabled = v.aiEnabled;
  if (v.aiDailyCap !== undefined) patch.aiDailyCap = v.aiDailyCap;
  if (v.retentionDays !== undefined) patch.retentionDays = v.retentionDays;
  if (v.notifyEmail !== undefined) {
    if (v.notifyEmail === null || v.notifyEmail.trim() === "") patch.notifyEmail = null;
    else {
      const e = normalizeEmail(v.notifyEmail);
      if (!e) return { ok: false, error: "notifyEmail: enter a valid email address" };
      patch.notifyEmail = e;
    }
  }
  if (v.replyTimeNote !== undefined) patch.replyTimeNote = v.replyTimeNote ? cleanText(v.replyTimeNote, LIMITS.replyTimeMax) || null : null;
  if (v.notes !== undefined) patch.supportKnowledge = { notes: parseNotes({ notes: v.notes }) };
  return { ok: true, patch };
}

export const SPACE_DEFAULTS = {
  title: "Support",
  brandColor: DEFAULT_BRAND,
  theme: "auto",
  aiDailyCap: LIMITS.aiCapDefault,
  retentionDays: LIMITS.retentionDefaultDays,
};
