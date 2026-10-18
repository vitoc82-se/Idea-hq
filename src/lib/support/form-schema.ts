import { z } from "zod";
import { LIMITS } from "./constants";
import { cleanText, normalizeEmail } from "./sanitize";

// The owner-defined support form. Email and Message are always present and are
// not part of the stored list.

export const FIELD_TYPES = ["text", "email", "textarea", "select", "checkbox", "number"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Ids the form itself uses; custom fields may not take them.
const RESERVED_IDS = new Set(["email", "message", "website", "token", "aiBlob"]);

const fieldSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "id must be lowercase letters, digits or _"),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
    helpText: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((f) => f.type !== "select" || (f.options && f.options.length >= 2), { message: "a choice field needs at least two options" });

export const formSchema = z
  .object({ fields: z.array(fieldSchema).max(LIMITS.maxFormFields) })
  .strict()
  .refine((f) => new Set(f.fields.map((x) => x.id)).size === f.fields.length, { message: "field ids must be unique" })
  .refine((f) => f.fields.every((x) => !RESERVED_IDS.has(x.id)), { message: "that field id is reserved" });

export type FormField = z.infer<typeof fieldSchema>;
export type FormDef = z.infer<typeof formSchema>;

export const DEFAULT_FORM: FormDef = {
  fields: [{ id: "name", label: "Your name", type: "text", required: false, maxLength: LIMITS.nameMax }],
};

// Starters offered by "Add a field" in the builder.
export const FIELD_STARTERS: { key: string; label: string; field: FormField }[] = [
  { key: "order", label: "Order number", field: { id: "order_number", label: "Order number", type: "text", required: false, maxLength: 60, helpText: "You can find it in your confirmation email" } },
  { key: "name", label: "Name", field: { id: "name", label: "Your name", type: "text", required: false, maxLength: LIMITS.nameMax } },
  { key: "phone", label: "Phone", field: { id: "phone", label: "Phone number", type: "text", required: false, maxLength: 40 } },
  { key: "custom", label: "Custom", field: { id: "custom", label: "Your question", type: "text", required: false, maxLength: 200 } },
];

// Reads whatever is stored; a bad or missing value falls back to the default.
export function parseFormDef(raw: unknown): FormDef {
  const r = formSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_FORM;
}

export function validateFormDef(raw: unknown): { ok: true; def: FormDef } | { ok: false; error: string } {
  const r = formSchema.safeParse(raw);
  if (r.success) return { ok: true, def: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join(".") || "form"}: ${issue.message}` : "Invalid form" };
}

export type Submission = {
  email: string;
  name: string | null;
  message: string;
  fields: { id: string; label: string; value: string }[];
};

// Validates a customer's submission against the form. Unknown fields are
// rejected, not ignored.
export function validateSubmission(
  def: FormDef,
  input: unknown
): { ok: true; value: Submission } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: { form: "Invalid request" } };
  const raw = input as Record<string, unknown>;

  const email = normalizeEmail(raw.email);
  if (!email) errors.email = "Enter a valid email address";

  const message = cleanText(raw.message, LIMITS.messageMax + 1);
  if (!message) errors.message = "Write a message";
  else if (message.length > LIMITS.messageMax) errors.message = `Keep it under ${LIMITS.messageMax} characters`;

  const given = raw.fields === undefined ? {} : raw.fields;
  if (!given || typeof given !== "object" || Array.isArray(given)) return { ok: false, errors: { form: "Invalid request" } };
  const givenMap = given as Record<string, unknown>;
  const known = new Set(def.fields.map((f) => f.id));
  for (const k of Object.keys(givenMap)) {
    if (!known.has(k)) errors.form = "Unexpected field";
  }

  const fields: Submission["fields"] = [];
  let name: string | null = null;
  for (const f of def.fields) {
    const v = givenMap[f.id];
    const empty = v === undefined || v === null || v === "" || v === false;
    if (empty) {
      if (f.required) errors[f.id] = "This is required";
      continue;
    }
    let text: string;
    if (f.type === "checkbox") {
      if (v !== true) {
        errors[f.id] = "Invalid value";
        continue;
      }
      text = "Yes";
    } else if (f.type === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) {
        errors[f.id] = "Enter a number";
        continue;
      }
      text = String(n);
    } else if (typeof v !== "string") {
      errors[f.id] = "Invalid value";
      continue;
    } else if (f.type === "select") {
      if (!f.options?.includes(v)) {
        errors[f.id] = "Pick one of the choices";
        continue;
      }
      text = v;
    } else if (f.type === "email") {
      const e = normalizeEmail(v);
      if (!e) {
        errors[f.id] = "Enter a valid email address";
        continue;
      }
      text = e;
    } else {
      const max = f.maxLength ?? (f.type === "textarea" ? 2000 : 200);
      text = cleanText(v, max + 1);
      if (text.length > max) {
        errors[f.id] = `Keep it under ${max} characters`;
        continue;
      }
      if (f.type === "text") text = text.replace(/\n+/g, " ");
    }
    if (!text) {
      if (f.required) errors[f.id] = "This is required";
      continue;
    }
    fields.push({ id: f.id, label: f.label, value: text });
    if (f.id === "name") name = text.slice(0, LIMITS.nameMax);
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { email: email!, name, message, fields } };
}
