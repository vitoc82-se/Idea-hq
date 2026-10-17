import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { canTransition, isActive, isTerminal, RUN_STATUSES } from "@/lib/runs/state";
import { summarizeChecks, appJwt } from "@/lib/github/client";
import { verifyWebhookSignature } from "@/lib/github/webhook";
import { buildWorkflow, buildPrompt, safeCommand, workflowVersion, WORKFLOW_VERSION, ALLOWED_TOOLS } from "@/lib/runs/workflow";
import { signState, verifyState } from "@/lib/runs/http";

describe("run state machine", () => {
  it("allows the happy path and nothing backwards", () => {
    expect(canTransition("awaiting_approval", "dispatched")).toBe(true);
    expect(canTransition("dispatched", "running")).toBe(true);
    expect(canTransition("running", "pr_open")).toBe(true);
    expect(canTransition("pr_open", "merged")).toBe(true);
    expect(canTransition("pr_open", "dispatched")).toBe(true); // revise
    expect(canTransition("merged", "pr_open")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("running", "running")).toBe(false);
    expect(canTransition("awaiting_approval", "merged")).toBe(false);
  });
  it("terminal and active classification", () => {
    for (const s of ["merged", "closed", "failed", "cancelled"]) expect(isTerminal(s)).toBe(true);
    for (const s of ["awaiting_approval", "dispatched", "running", "pr_open"]) expect(isTerminal(s)).toBe(false);
    expect(RUN_STATUSES.filter(isActive)).toEqual(["dispatched", "running"]);
  });
});

describe("summarizeChecks", () => {
  const ok = { context: "idea-hq/run", state: "success" };
  it("is green only when repo checks pass and our own verdict is success", () => {
    expect(summarizeChecks([{ name: "ci", status: "completed", conclusion: "success" }], [ok]).state).toBe("green");
  });
  it("is pending until our own verdict arrives", () => {
    expect(summarizeChecks([{ name: "ci", status: "completed", conclusion: "success" }], []).state).toBe("pending");
  });
  it("is red when our verdict failed, or any check failed", () => {
    expect(summarizeChecks([], [{ context: "idea-hq/run", state: "failure" }]).failing).toEqual(["idea-hq/run"]);
    expect(summarizeChecks([{ name: "ci", status: "completed", conclusion: "failure" }], [ok]).state).toBe("red");
  });
  it("is pending while checks are running", () => {
    expect(summarizeChecks([{ name: "ci", status: "in_progress", conclusion: null }], [ok]).state).toBe("pending");
  });
  it("a repo with no CI is gated on our verdict alone", () => {
    expect(summarizeChecks([], [ok]).state).toBe("green");
  });
  it("revert PRs do not need our verdict, but no checks at all stays pending", () => {
    expect(summarizeChecks([{ name: "ci", status: "completed", conclusion: "success" }], [], false).state).toBe("green");
    expect(summarizeChecks([], [], false).state).toBe("pending");
  });
  it("treats skipped and neutral as passing", () => {
    expect(summarizeChecks([{ name: "a", status: "completed", conclusion: "skipped" }, { name: "b", status: "completed", conclusion: "neutral" }], [ok]).state).toBe("green");
  });
});

describe("webhook signature", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a valid signature", () => expect(verifyWebhookSignature("s3cret", body, sig)).toBe(true));
  it("rejects a tampered body, wrong secret, missing or malformed header", () => {
    expect(verifyWebhookSignature("s3cret", body + " ", sig)).toBe(false);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, null)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, "sha1=abc")).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, "sha256=short")).toBe(false);
    expect(verifyWebhookSignature(undefined, body, sig)).toBe(false);
  });
});

describe("workflow template", () => {
  const wf = buildWorkflow({ appSlug: "idea-hq-app", buildCommand: "npm run build", testCommand: "npm test" });
  it("lets the app's bot dispatch, caps time and turns, and reports cost", () => {
    expect(wf).toContain('allowed_bots: "idea-hq-app"');
    expect(wf).toContain("timeout-minutes: 30");
    expect(wf).toContain("--max-turns ${{ inputs.max_turns ||");
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain('context="idea-hq/run"');
    expect(wf).toContain("npm run build || FAILED");
    expect(wf).toContain("npm test || FAILED");
    expect(wf).toContain("run-name:");
  });
  it("grants file-edit tools (first live run was denied without them) but no unrestricted shell", () => {
    expect(wf).toContain("--allowedTools");
    for (const t of ["Edit", "Write", "Read"]) expect(ALLOWED_TOOLS.split(",")).toContain(t);
    expect(ALLOWED_TOOLS.split(",")).not.toContain("Bash");
    expect(ALLOWED_TOOLS).not.toMatch(/curl|git push|git commit/);
  });
  it("takes model, effort and turn cap as run inputs, with safe defaults", () => {
    expect(wf).toContain("model:");
    expect(wf).toContain("effort:");
    expect(wf).toContain("max_turns:");
    expect(wf).toContain("--model ${{ inputs.model || 'claude-sonnet-5-5' }}");
    expect(wf).toContain("--effort ${{ inputs.effort || 'medium' }}");
    expect(wf).toContain("--max-turns ${{ inputs.max_turns || '40' }}");
  });
  it("is versioned so old installs are detected", () => {
    expect(workflowVersion(wf)).toBe(WORKFLOW_VERSION);
    expect(workflowVersion("name: x")).toBe(0);
  });
  it("does not run the AI's text through the shell", () => {
    // the prompt reaches the action as an input, never inside a run: block
    expect(wf).toContain("prompt: ${{ inputs.prompt }}");
    expect(wf.split("run: |").join("")).not.toContain("inputs.prompt }}\n          git");
  });
  it("rejects multi-line commands", () => {
    expect(() => buildWorkflow({ appSlug: "a", testCommand: "npm test\nrm -rf /" })).toThrow();
    expect(safeCommand("  ")).toBeNull();
    expect(safeCommand(" npm test ")).toBe("npm test");
  });
  it("prompt carries guardrails and the revision text", () => {
    const p = buildPrompt({ ideaTitle: "T", plan: "PLAN", revision: "make it blue", testCommand: "npm test" });
    expect(p).toContain("REVISION");
    expect(p).toContain("make it blue");
    expect(p).toContain("Do NOT edit anything under .github/workflows");
  });
});

describe("install state token", () => {
  beforeEach(() => { process.env.NEXTAUTH_SECRET = "test-secret"; });
  it("round-trips for the same user and expires", () => {
    const s = signState("u1", 1_000);
    expect(verifyState(s, "u1", 2_000)).toBe(true);
    expect(verifyState(s, "u2", 2_000)).toBe(false);
    expect(verifyState(s, "u1", 1_000 + 16 * 60 * 1000)).toBe(false);
  });
  it("rejects tampering and junk", () => {
    const s = signState("u1", 1_000);
    expect(verifyState(s.slice(0, -2) + "xx", "u1", 2_000)).toBe(false);
    expect(verifyState(null, "u1")).toBe(false);
    expect(verifyState("not-base64!!", "u1")).toBe(false);
  });
});

describe("appJwt", () => {
  it("signs RS256 with the right claims", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = appJwt("123", privateKey.export({ type: "pkcs8", format: "pem" }).toString(), 1_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ iss: "123", iat: 999_940, exp: 1_000_540 });
    expect(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});
