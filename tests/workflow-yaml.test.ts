import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { buildWorkflow, workflowVersion, requiredWorkflowVersion, WORKFLOW_VERSION, ALLOWED_TOOLS, buildPrompt } from "@/lib/runs/workflow";

// Version 6 of the workflow shipped with a newline inside a shell step that ended the YAML block early:
// GitHub refused the file ("No jobs were run") and mailed a failure on every push. Nothing parsed the
// generated file, so no test noticed. Every variant must be valid YAML now.
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (s: string) => unknown };

type Step = { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
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

// Everything the AI runs (and every script in the repo) could read what is on the runner. So: no git
// credentials stored, the token only in the two steps that talk to GitHub, the AI key kept out of the AI's shell,
// and a shell that can only run the project's own scripts.
describe("what the AI's shell can reach", () => {
  const wf = parse(buildWorkflow({ appSlug: "a", buildCommand: "npm run build", testCommand: "npm test" }));
  const steps = Object.values(wf.jobs)[0].steps;
  const byName = (n: string) => steps.find((s) => s.name === n)!;
  const agentIdx = steps.findIndex((s) => s.name === "Run Claude Code");

  it("the checkout stores no credentials", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout"))!;
    expect(checkout.with?.["persist-credentials"]).toBe(false);
  });
  it("only the branch and push steps (and the final report) get the repository token", () => {
    const withToken = steps.filter((s) => JSON.stringify(s.env ?? {}).includes("GITHUB_TOKEN")).map((s) => s.name);
    expect(withToken).toEqual(["Check out the working branch", "Push branch", "Report result"]);
    for (const s of steps) if (s.name === "Verify (build and tests)" || s.name === "Install dependencies") expect(JSON.stringify(s.env ?? {})).not.toMatch(/TOKEN/);
  });
  it("the token is used for one git command at a time, not written to the git settings", () => {
    for (const n of ["Check out the working branch", "Push branch"]) {
      const run = byName(n).run!;
      expect(run).toContain('git -c "http.https://github.com/.extraheader=$AUTH"');
      expect(run).not.toMatch(/git config[^\n]*extraheader|credential\.helper|store-credentials/);
    }
  });
  it("stored git credentials are removed after the AI step, before the repo's build and tests run", () => {
    const cleanup = steps.findIndex((s) => s.name === "Remove stored git credentials");
    const verify = steps.findIndex((s) => s.name === "Verify (build and tests)");
    expect(agentIdx).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(agentIdx);
    expect(verify).toBeGreaterThan(cleanup);
    expect(steps[cleanup].if).toContain("always()");
  });
  it("Claude Code is told not to pass the API key to the commands it runs", () => {
    expect(byName("Run Claude Code").env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
  });
  it("the shell allow-list has no bare npm, npx or node, no network tools and no git writes", () => {
    const tools = ALLOWED_TOOLS.split(",");
    for (const bad of ["Bash", "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(curl:*)", "Bash(git:*)", "Bash(sh:*)", "Bash(bash:*)"]) expect(tools).not.toContain(bad);
    expect(tools.filter((t) => t.startsWith("Bash(npx "))).toEqual(["Bash(npx tsc:*)", "Bash(npx vitest:*)", "Bash(npx jest:*)", "Bash(npx eslint:*)", "Bash(npx prettier:*)"]);
    // installs may only run without lifecycle scripts
    for (const t of tools.filter((t) => /Bash\(npm (install|ci)/.test(t))) expect(t).toContain("--ignore-scripts");
    expect(ALLOWED_TOOLS).not.toMatch(/curl|wget|git push|git commit|git config|\bnode\b|\bexec\b/);
  });
  it("the AI is told how to work within that", () => {
    const p = buildPrompt({ ideaTitle: "T", plan: "P" });
    expect(p).toContain("npm install --ignore-scripts");
    expect(p).toMatch(/Do not run npx, node/);
  });
});
