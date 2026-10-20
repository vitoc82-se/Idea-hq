import { cleanText } from "../support/sanitize";

// The workflow prints what the AI said at the end of a run, one log line at a time, each
// starting with this marker (see "Report result" in the workflow template). The marker is
// matched only at the start of a line (after GitHub's timestamp), so the script's own text,
// which also mentions it, is never mistaken for a note.
export const NOTE_MARKER = "IDEAHQ-NOTE|";
export const NOTE_MAX = 4000;

const LINE = /^(?:﻿)?(?:\d{4}-\d\d-\d\dT[\d:.]+Z )?IDEAHQ-NOTE\| ?(.*)$/;
const ANSI = /\u001b\[[0-9;]*m/g;

export function extractNote(log: string): string | null {
  const lines: string[] = [];
  for (const raw of log.split(/\r?\n/)) {
    const m = LINE.exec(raw.replace(ANSI, ""));
    if (m) lines.push(m[1]);
  }
  const note = cleanText(lines.join("\n"), NOTE_MAX);
  return note || null;
}
