# TODOS

## Multi-vendor AI run engines (Codex, Gemini, Grok CLIs)
**What:** Adapters behind the run-engine interface for Codex, Gemini and Grok CLIs.
**Why:** Friends may not have Anthropic keys; v1 ships Claude Code only (eng review 2026-10-17, D1).
**Pros:** Any major key works. **Cons:** Each CLI has different flags, output and cost reporting; more integration tests.
**Context:** Adapter seam is src/lib/runs (to be built). Start with Codex CLI.
**Depends on:** Claude path shipped; adapter interface from v1.

## Per-project daily/monthly spend caps
**What:** Refuse new runs once a project exceeds a daily or monthly budget.
**Why:** v1 only caps a single run (timeout + max turns) and one active run per project (D2).
**Pros:** Protects users from many-run overspend. **Cons:** Needs real cost data returned from the workflow; caps would be soft.
**Context:** Cost likely arrives as a check-run summary parsed from the webhook path.
**Depends on:** Spike proving claude-code-action can report usage; Run cost fields (T2).

## Store users' provider keys encrypted (and BYO-key helper calls)
**What:** Encrypted at-rest storage of OpenAI/Gemini/Anthropic keys, so Idea HQ can call providers on the user's own key and re-sync keys to new repos automatically.
**Why:** The multi-provider review (2026-10-18, D2) chose "relay once, never store". Revisit only if a trigger below happens.
**Triggers:** (1) the quick helper calls (estimate, plan, knowledge) must run on the user's own key instead of the owner's; (2) keys must be re-pushed to newly connected repos without the user pasting again.
**Required safeguards if built:** envelope encryption with a KMS-held master key (not just an env var), key-use audit log, never return plaintext, rotation/revoke/delete flows, key validation job, breach runbook and user notification, isolation tests on every route, privacy policy and terms.
**Depends on:** provider adapters shipped and a real need. **Cons:** custody of friends' billing credentials, about 3x the work of the relay.

## Estimate cost for OpenAI and Gemini runs from token usage
**What:** Show an estimated cost per run for non-Claude providers, like the Claude figure.
**Why:** v1 shows "not reported by this provider" because the Codex and Gemini actions return no cost or usage (review D5).
**Pros:** parity with Claude's cost display. **Cons:** price tables go stale; may not be possible if logs lack token counts.
**Depends on:** provider spike showing whether token usage appears in the logs, and a maintainable price source.
