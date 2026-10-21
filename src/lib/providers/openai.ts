import type { ProviderAdapter } from "./types";

// OpenAI (Codex). Off unless OPENAI_PROVIDER_ENABLED=1, which is set only after
// the live test passes (review D1, spike T6). The sandbox setting is checked by
// that live run.

// openai/codex-action v1 pinned by commit (review D4: exact versions).
export const CODEX_ACTION = "openai/codex-action@1d82a3dba7c7988ec71ecae1ed5b8e8db96495c5 # v1";

// The Codex CLI the action installs. Pinned so a new release cannot change runs
// under us, and new enough to know the models in the tier table (older CLIs warn
// "model metadata not found" and fall back, which can degrade results).
export const CODEX_CLI_VERSION = "0.163.0";

const q = (s: string) => JSON.stringify(s);

export const openai: ProviderAdapter = {
  id: "openai",
  label: "ChatGPT / OpenAI (Codex)",
  vendor: "OpenAI",
  secretName: "OPENAI_API_KEY",
  keyHelpUrl: "https://platform.openai.com/api-keys",
  keyHelpText: "an OpenAI API account (platform.openai.com). A ChatGPT subscription is not an API key",
  // Model ids verified against the API with this project's key on 2026-10-18; all
  // accept effort low, medium and high. "-pro" models are left out (far pricier)
  // and the 5.6 family until its size order is documented.
  models: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini", note: "cheapest, for small and clear changes" },
    { id: "gpt-5.4", label: "GPT-5.4", note: "balanced, the everyday choice" },
    { id: "gpt-5.5", label: "GPT-5.5", note: "strongest, for bigger changes" },
  ],
  tiers: [
    { model: "gpt-5.4-mini", effort: "low", maxTurns: 30 },
    { model: "gpt-5.4", effort: "medium", maxTurns: 50 },
    { model: "gpt-5.5", effort: "high", maxTurns: 80 },
    { model: "gpt-5.5", effort: "high", maxTurns: 100 },
  ],
  efforts: ["low", "medium", "high"],
  learnTier: { model: "gpt-5.4", effort: "high", maxTurns: 60 },
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
          codex-version: ${q(CODEX_CLI_VERSION)}
`;
  },
  successExpr: "steps.codex.outcome == 'success'",
};
