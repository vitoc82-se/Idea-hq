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
