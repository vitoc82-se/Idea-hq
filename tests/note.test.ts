import { describe, it, expect } from "vitest";
import { extractNote, NOTE_MAX } from "@/lib/runs/note";
import { buildWorkflow } from "@/lib/runs/workflow";

const ts = "2026-10-20T10:19:58.2526198Z";

describe("extractNote", () => {
  it("reads the lines the workflow printed, in order, without the timestamp or prefix", () => {
    const log = [`${ts} Some other output`, `${ts} IDEAHQ-NOTE| First line`, `${ts} IDEAHQ-NOTE| `, `${ts} IDEAHQ-NOTE| Third line`, `${ts} Post job cleanup.`].join("\n");
    expect(extractNote(log)).toBe("First line\n\nThird line");
  });
  it("is not fooled by the script's own text, which mentions the marker in the middle of a line", () => {
    const log = [`${ts} ##[group]Run NOTE=""`, `${ts} \u001b[36;1mif [ -n "$NOTE" ]; then printf '%s\\n' "$NOTE" | head -c 4000 | sed 's/^/IDEAHQ-NOTE| /'; fi\u001b[0m`, `${ts} IDEAHQ-NOTE| The real note`].join("\n");
    expect(extractNote(log)).toBe("The real note");
  });
  it("copes with a byte order mark, colour codes and Windows line endings", () => {
    expect(extractNote(`﻿${ts} \u001b[32mIDEAHQ-NOTE| Hello\u001b[0m\r\n${ts} IDEAHQ-NOTE| World\r\n`)).toBe("Hello\nWorld");
  });
  it("returns null when there is no note, and cleans hidden characters and caps the length", () => {
    expect(extractNote("nothing here")).toBeNull();
    expect(extractNote("")).toBeNull();
    expect(extractNote(`${ts} IDEAHQ-NOTE| Bad‮\u0000 text`)).toBe("Bad text");
    expect(extractNote(`${ts} IDEAHQ-NOTE| ${"x".repeat(NOTE_MAX + 500)}`)!.length).toBe(NOTE_MAX);
  });
});

describe("the workflow prints the note safely", () => {
  const wf = buildWorkflow({ buildCommand: "npm run build", testCommand: "npm test" } as never);
  it("prefixes every line so the AI's text can never act as a workflow command, and reads both the Claude result and the Codex message", () => {
    // v8: the AI's job collects the note (Claude result or Codex message); the publishing job prints it.
    const collect = wf.slice(wf.indexOf("- name: Hand over the AI's changes"), wf.indexOf("- name: Upload the AI's changes"));
    expect(collect).toContain("CODEX_NOTE: ${{ steps.codex.outputs.final-message }}");
    expect(collect).toMatch(/\.result \/\/ empty/);
    const step = wf.slice(wf.indexOf("- name: Report result"));
    expect(step).toContain("sed 's/^/IDEAHQ-NOTE| /'");
    expect(step).toContain("head -c 4000");
  });
});
