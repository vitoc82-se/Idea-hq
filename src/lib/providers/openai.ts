import type { ProviderAdapter } from "./types";

// OpenAI (Codex). The model names, effort values and sandbox profile below are
// PROVISIONAL until the live test passes (review D1, spike T6): the adapter is
// off unless OPENAI_PROVIDER_ENABLED=1, and the tier table is replaced with
// verified values once the key can list the real models.

// openai/codex-action v1 pinned by commit (review D4: exact versions).
export const CODEX_ACTION = "openai/codex-action@1d82a3dba7c7988ec71ecae1ed5b8e8db96495c5 # v1";

const q = (s: string) => JSON.stringify(s);

export const openai: ProviderAdapter = {
  id: "openai",
  label: "ChatGPT / OpenAI (Codex)",
  vendor: "OpenAI",
  secretName: "OPENAI_API_KEY",
  keyHelpUrl: "https://platform.openai.com/api-keys",
  keyHelpText: "an OpenAI API account (platform.openai.com). A ChatGPT subscription is not an API key",
  models: [
    { id: "gpt-5-mini", label: "GPT-5 mini", note: "cheapest, for small and clear changes (to verify)" },
    { id: "gpt-5", label: "GPT-5", note: "balanced (to verify)" },
    { id: "gpt-5-codex", label: "GPT-5 Codex", note: "tuned for coding (to verify)" },
  ],
  tiers: [
    { model: "gpt-5-mini", effort: "low", maxTurns: 15 },
    { model: "gpt-5", effort: "medium", maxTurns: 30 },
    { model: "gpt-5-codex", effort: "high", maxTurns: 50 },
    { model: "gpt-5-codex", effort: "high", maxTurns: 80 },
  ],
  efforts: ["low", "medium", "high"],
  learnTier: { model: "gpt-5", effort: "high", maxTurns: 40 },
  // The Codex action exposes no step cap and returns only the final message.
  supportsTurnCap: false,
  reportsCost: false,
  // Time is the only hard limit here (review D5): shorter on the cheap tiers.
  timeoutMinutes: (tierIndex) => (tierIndex <= 1 ? 15 : 30),
  enabled: () => process.env.OPENAI_PROVIDER_ENABLED === "1",

  async validateKey(key, fetchImpl = fetch) {
    if (!key || key.length < 20 || !/^[A-Za-z0-9_\-.]+$/.test(key)) return { ok: false, reason: "That does not look like an OpenAI API key." };
    try {
      const res = await fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "OpenAI rejected this key. Check that it is an API key from platform.openai.com." };
      return { ok: false, reason: `OpenAI could not check the key right now (status ${res.status}). Try again.` };
    } catch {
      return { ok: false, reason: "Could not reach OpenAI to check the key. Try again." };
    }
  },

  workflowStep({ appSlug }) {
    return `      - name: Run Codex
        if: \${{ inputs.provider == 'openai' }}
        id: codex
        uses: ${CODEX_ACTION}
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: \${{ inputs.prompt }}
          model: \${{ inputs.model }}
          effort: \${{ inputs.effort }}
          allow-bot-users: ${q(appSlug)}
          sandbox: workspace-write
`;
  },
  successExpr: "steps.codex.outcome == 'success'",
};
