// GOLDEN TESTS: freeze what the working Claude flow does today, so the
// multi-provider refactor cannot change it by accident (eng review D6).
// Intended changes are listed in the review: workflow version, a `provider`
// input, provider-guarded steps. Everything asserted here must stay true.
import { describe, it, expect } from "vitest";
import { buildWorkflow, ALLOWED_TOOLS, DEFAULT_MODEL } from "@/lib/runs/workflow";
import { CLAUDE_DISALLOWED_TOOLS } from "@/lib/providers/claude";
import { TIERS, MODELS, recommendTier, resolveTier, LEARN_TIER, planModel, PLANNING_MODEL } from "@/lib/runs/policy";

describe("golden: Claude tier table", () => {
  it("S to XL map to these exact models, efforts and turn caps", () => {
    expect(TIERS).toEqual([
      { model: "claude-haiku-5-5", effort: "low", maxTurns: 30 },
      { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 50 },
      { model: "claude-opus-5-5", effort: "high", maxTurns: 80 },
      { model: "claude-fable-5-1", effort: "high", maxTurns: 100 },
    ]);
  });
  it("offers exactly these models", () => {
    expect(MODELS.map((m) => m.id)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);
  });
  it("recommendation rules: bias shifts one tier, failures step up, unknown size starts on the cheapest", () => {
    expect(recommendTier("S").model).toBe("claude-haiku-5-5");
    expect(recommendTier("M", "saver").model).toBe("claude-haiku-5-5");
    expect(recommendTier("M", "max").model).toBe("claude-opus-5-5");
    expect(recommendTier("S", "auto", 1).model).toBe("claude-sonnet-5-5");
    expect(recommendTier(null).model).toBe("claude-haiku-5-5"); // was the middle tier before the practice-idea fix
  });
  it("override validation is unchanged (allow-listed model/effort, turns 5..100)", () => {
    const rec = recommendTier("S");
    expect(resolveTier(rec, { model: "claude-opus-5-5", effort: "max", maxTurns: 60 }).tier).toEqual({ model: "claude-opus-5-5", effort: "max", maxTurns: 60 });
    expect(resolveTier(rec, { model: "evil", effort: "ultra", maxTurns: 1 }).overridden).toBe(false);
  });
  it("learn runs and planning calls use the same models as before", () => {
    expect(LEARN_TIER).toEqual({ model: "claude-sonnet-5-5", effort: "high", maxTurns: 60 });
    expect(PLANNING_MODEL).toEqual({ estimate: "claude-sonnet-5-5", context: "claude-sonnet-5-5", breakdown: "claude-opus-5-5" });
    expect(planModel("S")).toBe("claude-sonnet-5-5");
    expect(planModel("XL")).toBe("claude-opus-5-5");
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
  });
});

describe("golden: Claude workflow step", () => {
  const wf = buildWorkflow({ appSlug: "idea-hq-niklas", buildCommand: "npm run build", testCommand: "npm test" });

  it("runs anthropics/claude-code-action with the key from the ANTHROPIC_API_KEY secret", () => {
    expect(wf).toContain("uses: anthropics/claude-code-action@");
    expect(wf).toContain("anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}");
    expect(wf).toContain("github_token: ${{ secrets.GITHUB_TOKEN }}");
  });
  it("allows the dispatching bot (the app) to run it", () => {
    expect(wf).toContain('allowed_bots: "idea-hq-niklas"');
  });
  it("wires model, effort and turn cap from the run inputs, with the same defaults", () => {
    expect(wf).toContain("--max-turns ${{ inputs.max_turns ||");
    expect(wf).toContain("--model ${{ inputs.model || 'claude-sonnet-5-5' }}");
    expect(wf).toContain("--effort ${{ inputs.effort || 'medium' }}");
  });
  it("grants exactly this tool allow-list and nothing like an unrestricted shell (v8: no bare npm, npx or node)", () => {
    expect(ALLOWED_TOOLS).toBe(
      "Edit,MultiEdit,Write,Read,Glob,Grep,Bash(npm test:*),Bash(npm run:*),Bash(npm ls:*),Bash(npm install --ignore-scripts:*),Bash(npm ci --ignore-scripts:*)," +
        "Bash(npx tsc:*),Bash(npx vitest:*),Bash(npx jest:*),Bash(npx eslint:*),Bash(npx prettier:*),Bash(ls:*),Bash(git diff:*),Bash(git status:*)"
    );
    expect(wf).toContain(`--allowedTools "${ALLOWED_TOOLS}"`);
    expect(wf).toContain(`--disallowedTools "${CLAUDE_DISALLOWED_TOOLS}"`);
  });
  it("passes the prompt as an action input, never through a shell", () => {
    expect(wf).toContain("prompt: ${{ inputs.prompt }}");
  });
  it("keeps the shared steps: verify, push, and the cost/turns status", () => {
    expect(wf).toContain("npm run build || FAILED");
    expect(wf).toContain("npm test || FAILED");
    expect(wf).toContain('push origin "HEAD:$BRANCH"');
    expect(wf).toContain('context="idea-hq/run"');
    expect(wf).toContain("total_cost_usd");
    expect(wf).toContain("num_turns");
    expect(wf).toContain("run=${{ inputs.run_id }} cost=");
  });
  it("keeps the dispatch inputs the engine sends and a run-name Idea HQ can match", () => {
    for (const i of ["run_id:", "branch:", "base:", "prompt:", "model:", "effort:", "max_turns:"]) expect(wf).toContain(i);
    expect(wf).toContain("run-name: ${{ format('idea-hq {0}', inputs.run_id) }}");
    expect(wf).toContain("workflow_dispatch:");
  });
  it("keeps the permissions and the time limit", () => {
    expect(wf).toContain("contents: write");
    expect(wf).toContain("statuses: write");
    expect(wf).toMatch(/timeout-minutes: /);
  });
});
