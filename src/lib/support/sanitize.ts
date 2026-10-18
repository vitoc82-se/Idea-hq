// Plain-text hygiene for everything customers and owners type. Nothing is ever
// rendered as HTML, but we still strip control and direction-override characters
// so text cannot disguise itself in an inbox or an email.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_AND_INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(BIDI_AND_INVISIBLE, "")
    .trim()
    .slice(0, max);
}

// One line, safe to put in an email header or subject.
export function headerSafe(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(CONTROL, "")
    .replace(BIDI_AND_INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  if (!e || e.length > 254 || /[\r\n]/.test(e) || !EMAIL_RE.test(e)) return null;
  return e;
}

export function firstLine(text: string, max: number): string {
  const line = text.split("\n").find((l) => l.trim()) || "";
  const t = line.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// Escapes text for the few places the server builds HTML strings (the widget
// shell: title, colours). Customer text never goes through here; it is always
// set with textContent in the browser.
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function normalizeOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password) return null;
  if (u.hostname.includes("*")) return null;
  return u.origin;
}

export function safeHttpsUrl(input: unknown, max = 500): string | null {
  if (typeof input !== "string" || !input.trim() || input.length > max) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
