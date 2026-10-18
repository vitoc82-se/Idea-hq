import type { ProviderAdapter } from "./types";

export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5-5";

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
    { model: "claude-haiku-5-5", effort: "low", maxTurns: 15 },
    { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 30 },
    { model: "claude-opus-5-5", effort: "high", maxTurns: 50 },
    { model: "claude-fable-5-1", effort: "high", maxTurns: 80 },
  ],
  efforts: ["low", "medium", "high", "max"],
  learnTier: { model: "claude-sonnet-5-5", effort: "high", maxTurns: 40 },
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

  // Unchanged from workflow v3 (frozen by the golden tests).
  workflowStep({ appSlug, maxTurns, allowedTools }) {
    return `      - name: Run Claude Code
        if: \${{ inputs.provider == 'claude' || inputs.provider == '' }}
        id: claude
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          github_token: \${{ secrets.GITHUB_TOKEN }}
          allowed_bots: ${q(appSlug)}
          prompt: \${{ inputs.prompt }}
          claude_args: --max-turns \${{ inputs.max_turns || '${maxTurns}' }} --model \${{ inputs.model || '${CLAUDE_DEFAULT_MODEL}' }} --effort \${{ inputs.effort || 'medium' }} --allowedTools "${allowedTools}"
`;
  },
  successExpr: "steps.claude.outputs.conclusion == 'success'",
};
