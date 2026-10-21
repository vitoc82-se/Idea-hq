import type { ProviderAdapter } from "./types";
import { ACTION_PINS } from "../runs/action-pins";

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5-5";

// Files the AI may not read (or, for .git, touch): the git settings, and the usual places secrets live. The scanner
// that builds project knowledge skips the same kinds of files (src/lib/repo-snapshot.ts).
export const CLAUDE_DISALLOWED_TOOLS = [
  "Read(.git/**)", "Edit(.git/**)", "Write(.git/**)",
  "Read(**/.env)", "Read(**/.env.local)", "Read(**/.env.production)", "Read(**/.env.development)",
  "Read(**/*.pem)", "Read(**/*.key)", "Read(**/id_rsa*)", "Read(**/id_ed25519*)", "Read(**/.ssh/**)", "Read(**/.aws/**)",
  "Read(**/.npmrc)", "Read(**/.netrc)", "Read(**/.pypirc)",
  "Read(**/*.tfvars)", "Read(**/*.tfstate)", "Read(**/*.p12)", "Read(**/*.pfx)",
].join(",");

const q = (s: string) => JSON.stringify(s);

export const claude: ProviderAdapter = {
  id: "claude",
  label: "Claude (Anthropic)",
  vendor: "Anthropic",
  secretName: "ANTHROPIC_API_KEY",
  keyHelpUrl: "https://console.anthropic.com/settings/keys",
  keyHelpText: "an Anthropic account (console.anthropic.com)",
  models: [
    { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "cheapest, for small and clear changes" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "balanced, the everyday choice" },
    { id: "claude-opus-5-5", label: "Opus 5.5", note: "strong, for bigger changes" },
    { id: "claude-fable-5-1", label: "Fable 5.1", note: "strongest, for the hardest work" },
  ],
  tiers: [
    // maxTurns is a ceiling against a run that goes round in circles, not a forecast: reading the code, editing and
    // running the checks takes more turns than it looks, and a run that hits the ceiling throws its work away.
    { model: "claude-haiku-5-5", effort: "low", maxTurns: 30 },
    { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 50 },
    { model: "claude-opus-5-5", effort: "high", maxTurns: 80 },
    { model: "claude-fable-5-1", effort: "high", maxTurns: 100 },
  ],
  efforts: ["low", "medium", "high", "max"],
  learnTier: { model: "claude-sonnet-5-5", effort: "high", maxTurns: 60 },
  supportsTurnCap: true,
  reportsCost: true,
  timeoutMinutes: () => 30,
  enabled: () => true,

  async validateKey(key, fetchImpl = fetch) {
    if (!key || key.length < 20) return { ok: false, reason: "That does not look like an Anthropic key." };
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "Anthropic rejected this key." };
      return { ok: false, reason: `Anthropic could not check the key right now (status ${res.status}). Try again.` };
    } catch {
      return { ok: false, reason: "Could not reach Anthropic to check the key. Try again." };
    }
  },

  // The same action as workflow v3 (frozen by the golden tests). Since v8 the step also tells Claude Code
  // not to hand the API key (or other cloud credentials) to the commands the AI runs.
  workflowStep({ appSlug, maxTurns, allowedTools }) {
    return `      - name: Run Claude Code
        if: \${{ inputs.provider == 'claude' || inputs.provider == '' }}
        id: claude
        uses: ${ACTION_PINS.claudeCode}
        env:
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ secrets.GITHUB_TOKEN }}
          allowed_bots: ${q(appSlug)}
          prompt: \${{ inputs.prompt }}
          claude_args: --max-turns \${{ inputs.max_turns || '${maxTurns}' }} --model \${{ inputs.model || '${CLAUDE_DEFAULT_MODEL}' }} --effort \${{ inputs.effort || 'medium' }} --allowedTools "${allowedTools}" --disallowedTools "${CLAUDE_DISALLOWED_TOOLS}"
`;
  },
  successExpr: "steps.claude.outputs.conclusion == 'success'",
};
