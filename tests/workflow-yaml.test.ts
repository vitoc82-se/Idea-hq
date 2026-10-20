import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { buildWorkflow, workflowVersion, requiredWorkflowVersion, WORKFLOW_VERSION } from "@/lib/runs/workflow";

// Version 6 of the workflow shipped with a newline inside a shell step that ended the YAML block early:
// GitHub refused the file ("No jobs were run") and mailed a failure on every push. Nothing parsed the
// generated file, so no test noticed. Every variant must be valid YAML now.
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => unknown };

type Step = { name?: string; run?: string; uses?: string; if?: string };
const parse = (text: string) => yaml.load(text) as { name: string; on: unknown; jobs: Record<string, { steps: Step[] }> };

const variants = [
  { appSlug: "idea-hq-app" },
  { appSlug: "idea-hq-app", buildCommand: "npm run build", testCommand: "npm test" },
  { appSlug: "x", buildCommand: "pnpm build", testCommand: "pnpm test", maxTurns: 10, timeoutMinutes: 15 },
  { appSlug: "x", testCommand: "pytest -q" },
];

describe("the generated workflow is valid YAML", () => {
  for (const [i, v] of Array.from(variants.entries())) {
    it(`variant ${i}`, () => {
      const wf = parse(buildWorkflow(v));
      expect(Object.keys(wf.jobs).length).toBeGreaterThan(0);
      for (const job of Object.values(wf.jobs)) {
        expect(job.steps.length).toBeGreaterThan(3);
        for (const s of job.steps) expect(Boolean(s.run || s.uses), JSON.stringify(s)).toBe(true);
      }
    });
  }
  it("the step that passes the AI's last message back keeps its escapes (they are text for jq and printf, not line breaks)", () => {
    const wf = parse(buildWorkflow(variants[1]));
    const run = Object.values(wf.jobs).flatMap((j) => j.steps).map((s) => s.run ?? "").find((r) => r.includes("IDEAHQ-NOTE|"))!;
    expect(run).toContain('join("\\n")');
    expect(run).toContain("printf '%s\\n' \"$NOTE\"");
    for (const line of run.split("\n")) expect(line.includes('join("') && !line.includes('")'), line).toBe(false);
  });
  it("this repo's own installed workflow parses too, and is not older than the template", () => {
    const path = ".github/workflows/idea-hq.yml";
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    expect(() => parse(text)).not.toThrow();
    expect(Number(text.match(/idea-hq-workflow-version:\s*(\d+)/)?.[1])).toBeGreaterThanOrEqual(WORKFLOW_VERSION);
  });
  it("a project that still has the broken version 6 is asked to update", () => {
    expect(workflowVersion("# idea-hq-workflow-version: 6\nname: x")).toBe(0);
    expect(workflowVersion("# idea-hq-workflow-version: 6\nname: x")).toBeLessThan(requiredWorkflowVersion("claude"));
    expect(workflowVersion("# idea-hq-workflow-version: 5\nname: x")).toBe(5);
    expect(workflowVersion("# idea-hq-workflow-version: 7\nname: x")).toBe(7);
  });
});
