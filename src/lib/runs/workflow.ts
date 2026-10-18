import { WORKFLOW_FILE } from "./state";
import { claude, openai } from "../providers";
import { CLAUDE_DEFAULT_MODEL } from "../providers/claude";
import { SECTION_DEFS, KNOWLEDGE_FILE, CLAUDE_IMPORT_LINE, type Knowledge } from "../knowledge";

// The workflow Idea HQ installs into a customer repo (via a one-time setup PR).
// Findings from the claude-code-action source read (eng review spike S6):
//  - workflow_dispatch + `prompt` runs in agent mode.
//  - A dispatch made by our GitHub App has a bot actor, so `allowed_bots` must
//    name the app or the action refuses to run.
//  - The action does not branch/commit/PR in agent mode, so this job does it:
//    it pushes `idea-hq/<runId>`, runs the project's checks in the same job, and
//    reports cost/turns as a commit status. Idea HQ then opens the PR with the
//    App token so the repo's own pull_request CI fires.

// Bump when the template changes. An installed workflow with an older version
// is refused at run time and offered as an update PR.
export const WORKFLOW_VERSION = 4;
// Claude runs only need the v3 inputs; the provider and timeout inputs arrived
// with v4. So a repo still on v3 keeps working for Claude and is only asked to
// update when its project switches to another provider.
export const MIN_WORKFLOW_VERSION = 3;
export function requiredWorkflowVersion(providerId: string | null | undefined): number {
  return providerId && providerId !== "claude" ? WORKFLOW_VERSION : MIN_WORKFLOW_VERSION;
}
export const VERSION_MARKER = "# idea-hq-workflow-version:";

export function workflowVersion(content: string): number {
  const m = new RegExp(`${VERSION_MARKER}\\s*(\\d+)`).exec(content);
  return m ? Number(m[1]) : 0;
}

// Tools the AI may use. Without an allow-list agent mode denies file edits (seen
// in the first live run: permission_denials_count 5). Bash is limited to reading
// and the project's own npm/node tooling; no git writes, no curl, no env dumps.
export const ALLOWED_TOOLS =
  "Edit,MultiEdit,Write,Read,Glob,Grep,Bash(npm:*),Bash(npx:*),Bash(node:*),Bash(ls:*),Bash(cat:*),Bash(git diff:*),Bash(git status:*)";

export const DEFAULT_MODEL = CLAUDE_DEFAULT_MODEL;

export type WorkflowOptions = {
  appSlug: string;
  buildCommand?: string | null;
  testCommand?: string | null;
  maxTurns?: number;
  timeoutMinutes?: number;
};

const q = (s: string) => JSON.stringify(s);

// Commands are inserted into a shell step. Reject anything with a newline so a
// stored command cannot smuggle extra steps into the workflow.
export function safeCommand(cmd: string | null | undefined): string | null {
  const c = (cmd || "").trim();
  if (!c) return null;
  if (/[\r\n]/.test(c)) throw new Error("Commands must be a single line");
  return c;
}

export function buildWorkflow(o: WorkflowOptions): string {
  const build = safeCommand(o.buildCommand);
  const test = safeCommand(o.testCommand);
  const maxTurns = o.maxTurns ?? 40;
  const timeout = o.timeoutMinutes ?? 30;
  const checks: string[] = [];
  if (build) checks.push(`          ${build} || FAILED="$FAILED build"`);
  if (test) checks.push(`          ${test} || FAILED="$FAILED tests"`);

  const stepOpts = { appSlug: o.appSlug, maxTurns, allowedTools: ALLOWED_TOOLS };
  const agentSteps = [claude, openai].map((p) => p.workflowStep(stepOpts)).join("\n").trimEnd();

  return `${VERSION_MARKER} ${WORKFLOW_VERSION}
name: Idea HQ
run-name: \${{ format('idea-hq {0}', inputs.run_id) }}

on:
  workflow_dispatch:
    inputs:
      run_id:
        description: Idea HQ run id
        required: true
      branch:
        description: Branch to create or update
        required: true
      base:
        description: Base branch
        required: true
      prompt:
        description: Instructions for the AI
        required: true
      provider:
        description: Which AI runs the work (claude or openai)
        required: false
        default: "claude"
      model:
        description: Model id for the chosen provider
        required: false
        default: ${q(DEFAULT_MODEL)}
      timeout_minutes:
        description: Hard time limit for the run
        required: false
        default: ${q(String(timeout))}
      effort:
        description: Reasoning effort (low, medium, high, max)
        required: false
        default: ${q("medium")}
      max_turns:
        description: Turn cap for the AI
        required: false
        default: ${q(String(maxTurns))}

permissions:
  contents: write
  statuses: write

jobs:
  implement:
    runs-on: ubuntu-latest
    timeout-minutes: \${{ fromJSON(inputs.timeout_minutes || '${timeout}') }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ inputs.base }}

      - name: Check out the working branch
        env:
          BRANCH: \${{ inputs.branch }}
        run: |
          if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
            git fetch origin "$BRANCH"
            git checkout "$BRANCH"
          else
            git checkout -b "$BRANCH"
          fi

      - uses: actions/setup-node@v4
        if: \${{ hashFiles('package.json') != '' }}
        with:
          node-version: 20

      - name: Install dependencies
        if: \${{ hashFiles('package-lock.json') != '' }}
        run: npm ci

${agentSteps}
      - name: Verify (build and tests)
        id: verify
        run: |
          FAILED=""
${checks.length ? checks.join("\n") : '          echo "No build or test command configured"'}
          echo "failed=$FAILED" >> "$GITHUB_OUTPUT"

      - name: Push branch
        id: push
        env:
          BRANCH: \${{ inputs.branch }}
        run: |
          git config user.name "idea-hq[bot]"
          git config user.email "idea-hq@users.noreply.github.com"
          git add -A
          git commit -m "Idea HQ run \${{ inputs.run_id }}" || echo "Nothing to commit"
          git push origin "HEAD:$BRANCH"
          echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"

      - name: Report result
        if: \${{ always() }}
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          EXEC_FILE: \${{ steps.claude.outputs.execution_file }}
          SHA: \${{ steps.push.outputs.sha }}
          FAILED: \${{ steps.verify.outputs.failed }}
          AGENT_OK: \${{ ${claude.successExpr} || ${openai.successExpr} }}
        run: |
          COST=""; TURNS=""
          if [ -n "$EXEC_FILE" ] && [ -f "$EXEC_FILE" ]; then
            COST=$(jq -r '[.[] | select(.type=="result")] | last | .total_cost_usd // empty' "$EXEC_FILE" 2>/dev/null || true)
            TURNS=$(jq -r '[.[] | select(.type=="result")] | last | .num_turns // empty' "$EXEC_FILE" 2>/dev/null || true)
          fi
          STATE=success
          [ "$AGENT_OK" = "true" ] || STATE=failure
          [ -z "$FAILED" ] || STATE=failure
          [ -n "$SHA" ] || SHA="\${{ github.sha }}"
          gh api "repos/\${{ github.repository }}/statuses/$SHA" \\
            -f state="$STATE" -f context="idea-hq/run" \\
            -f description="run=\${{ inputs.run_id }} cost=\${COST:-?} turns=\${TURNS:-?} failed=\${FAILED:-none}"
`;
}

export { WORKFLOW_FILE };

// What the AI is told. The approved plan is the spec; guardrails keep it inside
// the repo and out of git/CI plumbing that the workflow owns.
export function buildPrompt(args: {
  ideaTitle: string;
  plan: string;
  revision?: string | null;
  testCommand?: string | null;
}): string {
  const test = safeCommand(args.testCommand);
  return [
    `You are implementing a backlog idea in this repository: "${args.ideaTitle}".`,
    args.revision
      ? `This is a REVISION of work already on this branch. Apply only this requested change on top of it:\n${args.revision}\n\nOriginal approved plan, for context:\n${args.plan}`
      : `Approved plan:\n${args.plan}`,
    "Rules:",
    "- Implement the whole change. Keep the diff small and in the style of the surrounding code.",
    `- Write or update automated tests for the new behavior${test ? ` (project test command: ${test})` : ""}. If the repo has no test setup, say so in your final message instead of adding a framework.`,
    "- Make sure the project type-checks and builds.",
    "- Do NOT run git commit, git push or open pull requests. The workflow does that.",
    "- If the plan mentions feature branches, merging, pushing or deploying, ignore those steps: the workflow owns all git and deploy work. Only change files in the working tree.",
    "- Verify with the project's own commands (type-check, tests, build) before you finish.",
    "- Do NOT edit anything under .github/workflows, and never print or write secrets.",
    "- Finish with a short summary of what changed and what you tested.",
  ].join("\n");
}

// Instructions for a "learn this project" run: explore the whole repo and write
// what it finds in the exact headings Idea HQ reads back.
export function buildLearnPrompt(projectName: string, known: Knowledge): string {
  const told = SECTION_DEFS.filter((d) => known.sections[d.id]?.status === "confirmed")
    .map((d) => `### ${d.title}\n${known.sections[d.id]!.text}`)
    .join("\n\n");
  return [
    `Learn the project "${projectName}" by exploring this repository, then write down what you learned for people and AI tools that will work on it later.`,
    "",
    `Write ONE file: ${KNOWLEDGE_FILE}. Use exactly these second-level headings, in this order, and skip a heading only if you truly cannot tell:`,
    ...SECTION_DEFS.filter((d) => d.core).map((d) => `## ${d.title}   (${d.hint})`),
    "",
    "How to explore: list the folders, read the README and any docs, the dependency/manifest files, the main entry points, the routes or pages, the data models or schema, the build and CI configuration, and a couple of representative source files. Follow imports to understand how the parts fit together.",
    "Rules for the writing:",
    "- Plain, concrete language. The reader may not be a developer. Name real folders, files, commands and data models you saw.",
    "- Only write what you verified in the repo. Never invent. If you are unsure, say what you could not tell.",
    "- Keep each section under 180 words.",
    told ? `\nThe owner already confirmed these facts. Keep them, do not contradict them:\n${told}` : "",
    "",
    `Also make sure CLAUDE.md in the repository root contains the line ${CLAUDE_IMPORT_LINE}. If CLAUDE.md does not exist, create it with a short title and that line. If it exists, add that line at the end and change nothing else.`,
    "Do not change any other file. Do NOT run git commit, git push or open pull requests: the workflow does that. Do not edit anything under .github/workflows, and never print or write secrets.",
    "Finish with a two-sentence summary of what you found.",
  ].filter((l) => l !== "").join("\n");
}
