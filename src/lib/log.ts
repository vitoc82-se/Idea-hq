// What the server writes to its log when something fails. A database or network error can carry the values that were
// being saved (an email address, the text of an idea, a customer's message), so the log gets only what is needed to
// find the problem: a label, the kind of error, and its code or status. Never the message, the stack or the details.
export function logError(label: string, error?: unknown, ...context: (string | number | null | undefined)[]): void {
  const e = error as { name?: unknown; code?: unknown; status?: unknown } | null | undefined;
  const parts: string[] = [label];
  for (const c of context) if (c !== null && c !== undefined && c !== "") parts.push(String(c).slice(0, 80));
  if (error !== undefined) {
    parts.push(typeof e?.name === "string" ? e.name.slice(0, 60) : typeof error);
    if (typeof e?.code === "string" || typeof e?.code === "number") parts.push(`code=${String(e.code).slice(0, 30)}`);
    if (typeof e?.status === "number") parts.push(`status=${e.status}`);
  }
  console.error(parts.join(" "));
}
