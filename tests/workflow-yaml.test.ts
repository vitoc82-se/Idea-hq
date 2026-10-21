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
  it("the AI's last message is passed back with its escapes intact (they are text for jq and printf, not line breaks)", () => {
    const wf = parse(buildWorkflow(variants[1]));
    const all = Object.values(wf.jobs).flatMap((j) => j.steps).map((s) => s.run ?? "");
    const handover = all.find((r) => r.includes("meta.json") && r.includes("jq -n"))!;
    const report = all.find((r) => r.includes("IDEAHQ-NOTE|"))!;
    expect(handover).toContain('join("\\n")');
    expect(report).toContain("printf '%s\\n' \"$NOTE\"");
    for (const run of [handover, report]) for (const line of run.split("\n")) expect(line.includes('join("') && !line.includes('")'), line).toBe(false);
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

// Everything the AI runs (and every script in the repo) could read what is on the runner. So the work is split:
// the AI has the AI key but only a read-only repository token and hands over a patch; the job that can write
// never has the AI key and never runs the AI.
describe("what the AI's shell can reach", () => {
  const wf = parse(buildWorkflow({ appSlug: "a", buildCommand: "npm run build", testCommand: "npm test" }));
  const jobs = wf.jobs as unknown as Record<string, { steps: Step[]; permissions?: Record<string, string>; needs?: string; if?: string }>;
  const implement = jobs.implement;
  const publish = jobs.publish;
  const names = (j: { steps: Step[] }) => j.steps.map((s) => s.name ?? s.uses);

  it("two jobs: the AI works in one that can only read; the one that can write never runs the AI", () => {
    expect(Object.keys(jobs)).toEqual(["implement", "publish"]);
    expect((wf as unknown as { permissions: unknown }).permissions).toEqual({});
    expect(implement.permissions).toEqual({ contents: "read" });
    expect(publish.permissions).toEqual({ contents: "write", statuses: "write" });
    expect(names(implement)).toContain("Run Claude Code");
    expect(names(implement)).toContain("Run Codex");
    expect(names(publish)).not.toContain("Run Claude Code");
    expect(names(publish)).not.toContain("Run Codex");
    expect(JSON.stringify(publish)).not.toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);
  });
  it("publish waits for implement and still reports when it failed", () => {
    expect(publish.needs).toBe("implement");
    expect(publish.if).toContain("always()");
  });
  it("neither checkout stores credentials", () => {
    for (const j of [implement, publish]) {
      const checkout = j.steps.find((s) => s.uses?.startsWith("actions/checkout"))!;
      expect(checkout.with?.["persist-credentials"]).toBe(false);
    }
  });
  it("the write token is used only by the git commands that need it, one command at a time", () => {
    const withToken = (j: { steps: Step[] }) => j.steps.filter((s) => JSON.stringify(s.env ?? {}).includes("GITHUB_TOKEN")).map((s) => s.name);
    expect(withToken(implement)).toEqual(["Check out the working branch"]);
    expect(withToken(publish)).toEqual(["Check out the working branch", "Push branch", "Report result"]);
    for (const j of [implement, publish]) {
      for (const n of ["Check out the working branch", "Push branch"]) {
        const step = j.steps.find((s) => s.name === n);
        if (!step) continue;
        expect(step.run).toContain('git -c "http.https://github.com/.extraheader=$AUTH"');
        expect(step.run).not.toMatch(/git config[^\n]*extraheader|credential\.helper|store-credentials/);
      }
    }
    // the repo's own build and tests get no token
    const verify = publish.steps.find((s) => s.name === "Verify (build and tests)")!;
    expect(JSON.stringify(verify.env ?? {})).not.toMatch(/TOKEN/);
  });
  it("what the Claude action writes into the git settings is removed before anything leaves the AI's job", () => {
    const agent = implement.steps.findIndex((s) => s.name === "Run Claude Code");
    const handover = implement.steps.findIndex((s) => s.name === "Hand over the AI's changes");
    expect(handover).toBeGreaterThan(agent);
    expect(implement.steps[handover].if).toContain("always()");
    expect(implement.steps[handover].run).toContain("git remote set-url origin");
    expect(implement.steps[handover].run).toContain("--unset-all http.https://github.com/.extraheader");
    expect(implement.steps[handover].run).toContain(":(exclude).github/workflows");
  });
  it("changes travel as a patch and a small summary, not the whole AI transcript", () => {
    const upload = implement.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))!;
    expect(upload.with?.name).toBe("idea-hq-output");
    expect(upload.with?.["retention-days"]).toBe(1);
    const handover = implement.steps.find((s) => s.name === "Hand over the AI's changes")!;
    expect(handover.run).toContain("changes.patch");
    expect(handover.run).not.toContain("cp \"$EXEC_FILE\"");
    const apply = publish.steps.find((s) => s.name === "Apply the AI's changes")!;
    expect(apply.run).toContain("git apply --index");
    // the patch is applied before the install and the checks, so they test what will be pushed
    const order = names(publish);
    expect(order.indexOf("Apply the AI's changes")).toBeLessThan(order.indexOf("Install dependencies"));
    expect(order.indexOf("Install dependencies")).toBeLessThan(order.indexOf("Verify (build and tests)"));
    expect(order.indexOf("Verify (build and tests)")).toBeLessThan(order.indexOf("Push branch"));
  });
  it("Claude Code is told not to pass the API key to the commands it runs, and has what that needs", () => {
    const agent = implement.steps.find((s) => s.name === "Run Claude Code")!;
    expect(agent.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
    const order = names(implement);
    expect(order.indexOf("Install the shell sandbox tools")).toBeGreaterThan(-1);
    expect(order.indexOf("Install the shell sandbox tools")).toBeLessThan(order.indexOf("Run Claude Code"));
    // without both, every shell command of the AI fails ("Sandbox is required but failed to initialize")
    const install = implement.steps.find((s) => s.name === "Install the shell sandbox tools")!;
    expect(install.run).toMatch(/bubblewrap/);
    expect(install.run).toMatch(/socat/);
    expect(install.run).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
  });
  it("the shell allow-list has no bare npm, npx or node, no network tools and no git writes", () => {
    const tools = ALLOWED_TOOLS.split(",");
    for (const bad of ["Bash", "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(curl:*)", "Bash(git:*)", "Bash(sh:*)", "Bash(bash:*)", "Bash(cat:*)"]) expect(tools).not.toContain(bad);
    expect(tools.filter((t) => t.startsWith("Bash(npx "))).toEqual(["Bash(npx tsc:*)", "Bash(npx vitest:*)", "Bash(npx jest:*)", "Bash(npx eslint:*)", "Bash(npx prettier:*)"]);
    // installs may only run without lifecycle scripts
    for (const t of tools.filter((t) => /Bash\(npm (install|ci)/.test(t))) expect(t).toContain("--ignore-scripts");
    expect(ALLOWED_TOOLS).not.toMatch(/curl|wget|git push|git commit|git config|\bnode\b|\bexec\b/);
  });
  it("the AI cannot read the git settings", () => {
    const agent = implement.steps.find((s) => s.name === "Run Claude Code")!;
    expect(String(agent.with?.claude_args)).toContain('--disallowedTools "Read(.git/**),Edit(.git/**),Write(.git/**)"');
  });
  it("the AI is told how to work within that", () => {
    const p = buildPrompt({ ideaTitle: "T", plan: "P" });
    expect(p).toContain("npm install --ignore-scripts");
    expect(p).toMatch(/Do not run npx, node/);
  });
});

describe("actions are pinned to exact commits", () => {
  it("every action in the generated workflow and in this repo's own workflows is a full commit id", () => {
    const text = [buildWorkflow({ appSlug: "a" }), readFileSync(".github/workflows/ci.yml", "utf8"), readFileSync(".github/workflows/idea-hq.yml", "utf8")].join("\n");
    const uses = Array.from(text.matchAll(/^\s*(?:- )?uses: (\S+)/gm)).map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(8);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
