import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeFakeDb } from "./fakedb";
import { listProviders, getProvider, isProviderId, claude, openai, type ProviderAdapter } from "@/lib/providers";
import { buildWorkflow, ALLOWED_TOOLS, WORKFLOW_VERSION, requiredWorkflowVersion } from "@/lib/runs/workflow";
import { recommendTier, resolveTier, timeoutFor } from "@/lib/runs/policy";

const holder = vi.hoisted(() => ({ db: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, k) => holder.db[k as string] }) }));
import { startRun, approveRun, startLearnRun } from "@/lib/runs/engine";

// ---- the contract every adapter must satisfy (review D6) --------------------
const ALL: ProviderAdapter[] = [claude, openai];

describe.each(ALL.map((p) => [p.id, p] as const))("provider contract: %s", (_id, p) => {
  const wf = buildWorkflow({ appSlug: "idea-hq-niklas", buildCommand: "npm test", testCommand: null });

  it("names its secret in the conventional way and the workflow reads exactly that secret", () => {
    expect(p.secretName).toMatch(/^[A-Z][A-Z0-9_]*_API_KEY$/);
    expect(wf).toContain(`secrets.${p.secretName}`);
  });
  it("has four tiers (S to XL), cheap to strong, all using models it offers", () => {
    expect(p.tiers).toHaveLength(4);
    const ids = p.models.map((m) => m.id);
    for (const t of p.tiers) {
      expect(ids).toContain(t.model);
      expect(p.efforts).toContain(t.effort);
      expect(t.maxTurns).toBeGreaterThanOrEqual(5);
    }
    expect(p.tiers.map((t) => t.maxTurns)).toEqual([...p.tiers.map((t) => t.maxTurns)].sort((a, b) => a - b));
    expect(ids).toContain(p.learnTier.model);
  });
  it("only ever allows its own models, and rejects anything else (no flag injection)", () => {
    const rec = recommendTier("M", "auto", 0, p.id);
    const bad = resolveTier(rec, { model: "x --dangerous", effort: "ultra", maxTurns: 99999 }, p.id);
    expect(bad.overridden).toBe(false);
    expect(p.models.map((m) => m.id)).toContain(bad.tier.model);
  });
  it("guards its workflow step by provider, so only the chosen vendor's step (and key) runs", () => {
    const step = p.workflowStep({ appSlug: "idea-hq-niklas", maxTurns: 40, allowedTools: ALLOWED_TOOLS });
    expect(step).toContain(`inputs.provider == '${p.id}'`);
    expect(step).toContain(`secrets.${p.secretName}`);
  });
  it("lets the dispatching bot run it (bot allow-list present)", () => {
    expect(p.workflowStep({ appSlug: "idea-hq-niklas", maxTurns: 40, allowedTools: ALLOWED_TOOLS })).toContain("idea-hq-niklas");
  });
  it("passes the prompt as an input, never through a shell", () => {
    const step = p.workflowStep({ appSlug: "a", maxTurns: 10, allowedTools: ALLOWED_TOOLS });
    expect(step).toContain("prompt: ${{ inputs.prompt }}");
    expect(step).not.toMatch(/run:\s*\|/);
  });
  it("has a time limit for every tier", () => {
    for (let i = 0; i < 4; i++) expect(p.timeoutMinutes(i)).toBeGreaterThan(0);
  });
  it("rejects obviously malformed keys without touching the network", async () => {
    const never = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect((await p.validateKey("", never)).ok).toBe(false);
  });
  it("is found by the registry", () => {
    expect(isProviderId(p.id)).toBe(true);
    expect(getProvider(p.id)).toBe(p);
  });
});

describe("registry", () => {
  afterEach(() => { delete process.env.OPENAI_PROVIDER_ENABLED; });
  it("falls back to Claude for unknown or missing ids (the original behavior)", () => {
    for (const x of [undefined, null, "", "gemini", "nonsense"]) expect(getProvider(x as string)).toBe(claude);
  });
  it("offers OpenAI only once it is switched on; Claude is always on", () => {
    expect(listProviders({ enabledOnly: true }).map((p) => p.id)).toEqual(["claude"]);
    process.env.OPENAI_PROVIDER_ENABLED = "1";
    expect(listProviders({ enabledOnly: true }).map((p) => p.id)).toEqual(["claude", "openai"]);
  });
});

describe("workflow v4", () => {
  const wf = buildWorkflow({ appSlug: "idea-hq-niklas" });
  it("is version 4 with a provider input defaulting to Claude, and a per-run time limit", () => {
    expect(WORKFLOW_VERSION).toBeGreaterThanOrEqual(5);
    expect(wf).toContain(`# idea-hq-workflow-version: ${WORKFLOW_VERSION}`);
    expect(wf).toMatch(/provider:\n\s+description:[^\n]*\n\s+required: false\n\s+default: "claude"/);
    expect(wf).toContain("timeout_minutes:");
    expect(wf).toContain("timeout-minutes: ${{ fromJSON(inputs.timeout_minutes ||");
  });
  it("runs the Codex step only for openai, pinned to a commit, with the bot allow-list and no secrets in the shell", () => {
    expect(wf).toMatch(/uses: openai\/codex-action@[0-9a-f]{40} # v1/);
    expect(wf).toContain("allow-bot-users: \"idea-hq-niklas\"");
    expect(wf).toContain("openai-api-key: ${{ secrets.OPENAI_API_KEY }}");
    expect(wf).toContain("if: ${{ inputs.provider == 'openai' }}");
  });
  it("pins the Codex CLI so a new release cannot change runs, and uses the verified models", () => {
    expect(wf).toMatch(/codex-version: "\d+\.\d+\.\d+"/);
    expect(openai.models.map((m) => m.id)).toEqual(["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]);
    expect(openai.efforts).toEqual(["low", "medium", "high"]);
    expect(wf).toContain("sandbox: workspace-write");
  });
  it("judges success from whichever agent step ran", () => {
    expect(wf).toContain("AGENT_OK: ${{ steps.claude.outputs.conclusion == 'success' || steps.codex.outcome == 'success' }}");
    expect(wf).toContain('[ "$AGENT_OK" = "true" ] || STATE=failure');
  });
  it("never references a secret outside a guarded step", () => {
    const lines = wf.split("\n");
    lines.forEach((l, i) => {
      if (/secrets\.(ANTHROPIC|OPENAI)_API_KEY/.test(l)) {
        const stepStart = lines.slice(0, i).reverse().findIndex((x) => /^\s+- name: /.test(x));
        const header = lines.slice(i - stepStart - 1, i).join("\n");
        expect(header, `unguarded secret at line ${i + 1}`).toMatch(/if: \$\{\{ inputs\.provider == /);
      }
    });
  });
  it("OpenAI tiers get a shorter hard timeout on the cheap tiers, a longer one on strong tiers", () => {
    expect(openai.timeoutMinutes(0)).toBe(15);
    expect(openai.timeoutMinutes(1)).toBe(15);
    expect(openai.timeoutMinutes(2)).toBe(30);
    expect(timeoutFor("openai", openai.tiers[3].model, 0)).toBe(30);
    expect(timeoutFor("claude", "claude-haiku-5-5", 0)).toBe(30);
  });
});

// ---- the engine, per provider ------------------------------------------------
let t: ReturnType<typeof makeFakeDb>;
let inputs: Record<string, string> | null;
let installedVersion = WORKFLOW_VERSION;
const gh = {
  repoBranch: async () => ({ sha: "base1", protected: true }),
  getFile: async () => ({ sha: "w", content: `# idea-hq-workflow-version: ${installedVersion}` }),
  secretExists: async (_i: number, _o: string, _r: string, name: string) => { askedSecret = name; return secretOk; },
  dispatchWorkflow: async (_i: number, _o: string, _r: string, _f: string, _ref: string, inp: Record<string, string>) => { inputs = inp; },
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
let askedSecret = "";
let secretOk = true;

function seed(provider: string, complexity: string | null = "S") {
  t.tables.user.push({ id: "u1" });
  t.tables.project.push({ id: "p1", userId: "u1", name: "P", installationId: 5, repoOwner: "acme", repoName: "app", envBranches: { live: "main" }, defaultEnv: "live", workflowInstalled: true, aiProvider: provider, aiBias: "auto", knowledge: null, context: "" });
  t.tables.idea.push({ id: "i1", userId: "u1", projectId: "p1", title: "T", plan: "PLAN", status: "new", blockedBy: [], complexity });
}

describe("engine with the OpenAI provider", () => {
  beforeEach(() => { t = makeFakeDb(); holder.db = t.db; inputs = null; installedVersion = WORKFLOW_VERSION; askedSecret = ""; secretOk = true; process.env.OPENAI_PROVIDER_ENABLED = "1"; });
  afterEach(() => { delete process.env.OPENAI_PROVIDER_ENABLED; });

  it("dispatches provider=openai with the OpenAI tier, the shorter timeout, and checks OPENAI_API_KEY", async () => {
    seed("openai", "S");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(askedSecret).toBe("OPENAI_API_KEY");
    expect(inputs).toMatchObject({ provider: "openai", model: openai.tiers[0].model, effort: openai.tiers[0].effort, timeout_minutes: "15" });
    expect(t.tables.run[0]).toMatchObject({ provider: "openai", model: openai.tiers[0].model });
  });

  it("a big idea gets the strong tier and the longer timeout", async () => {
    seed("openai", "L");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(inputs).toMatchObject({ provider: "openai", model: openai.tiers[2].model, timeout_minutes: "30" });
  });

  it("refuses with a clear message when the OpenAI secret is missing", async () => {
    seed("openai");
    secretOk = false;
    const r = await startRun("u1", "i1", { gh });
    await expect(approveRun("u1", r.id, { gh })).rejects.toThrow(/Secret named OPENAI_API_KEY/);
    expect(t.tables.run[0].status).toBe("awaiting_approval");
  });

  it("refuses while the provider is switched off", async () => {
    seed("openai");
    delete process.env.OPENAI_PROVIDER_ENABLED;
    const r = await startRun("u1", "i1", { gh });
    await expect(approveRun("u1", r.id, { gh })).rejects.toThrow(/not available yet/);
    expect(inputs).toBeNull();
  });

  it("only accepts OpenAI models for an OpenAI run (a Claude model id is ignored)", async () => {
    seed("openai", "S");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh }, { model: "claude-opus-5-5", effort: "high" });
    expect(inputs!.model).toBe(openai.tiers[0].model);
  });

  it("Claude projects are untouched: provider=claude, ANTHROPIC_API_KEY, 30 minutes", async () => {
    seed("claude", "S");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(askedSecret).toBe("ANTHROPIC_API_KEY");
    expect(inputs).toMatchObject({ provider: "claude", model: "claude-haiku-5-5", effort: "low", max_turns: "30", timeout_minutes: "30" });
  });

  it("learn runs use the project's provider and its learn tier", async () => {
    seed("openai");
    await startLearnRun("u1", "p1", { gh });
    expect(inputs).toMatchObject({ provider: "openai", model: openai.learnTier.model, effort: openai.learnTier.effort });
  });

  it("a project with an unknown stored provider behaves as Claude", async () => {
    seed("weird");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(inputs!.provider).toBe("claude");
  });
});

describe("rollout: repos still on workflow v3", () => {
  beforeEach(() => { t = makeFakeDb(); holder.db = t.db; inputs = null; askedSecret = ""; secretOk = true; installedVersion = 3; process.env.OPENAI_PROVIDER_ENABLED = "1"; });
  afterEach(() => { delete process.env.OPENAI_PROVIDER_ENABLED; });

  it("Claude keeps working on v3 and is sent ONLY the inputs v3 declares (no provider, no timeout)", async () => {
    seed("claude", "S");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(Object.keys(inputs!).sort()).toEqual(["base", "branch", "effort", "max_turns", "model", "prompt", "run_id"]);
    expect(inputs).toMatchObject({ model: "claude-haiku-5-5", effort: "low", max_turns: "30" });
  });

  it("OpenAI on a v3 repo is refused with a clear 'update the workflow' message, nothing dispatched", async () => {
    seed("openai", "S");
    const r = await startRun("u1", "i1", { gh });
    await expect(approveRun("u1", r.id, { gh })).rejects.toThrow(/outdated for this AI provider/);
    expect(inputs).toBeNull();
    expect(t.tables.run[0].status).toBe("awaiting_approval");
  });

  it("a v4 repo gets the new inputs for Claude too", async () => {
    installedVersion = 4;
    seed("claude", "S");
    const r = await startRun("u1", "i1", { gh });
    await approveRun("u1", r.id, { gh });
    expect(inputs).toMatchObject({ provider: "claude", timeout_minutes: "30" });
  });

  it("the version a project needs depends on its provider", () => {
    expect(requiredWorkflowVersion("claude")).toBe(3);
    expect(requiredWorkflowVersion(undefined)).toBe(3);
    expect(requiredWorkflowVersion("openai")).toBe(4);
  });
});
