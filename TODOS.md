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

## Ticket attachments (screenshots)
**What:** Let customers attach images to support tickets, stored privately with expiring links.
**Why:** Faster support. Left out of v1 of the ticket system because anonymous uploads are the riskiest public surface (eng review 2026-10-18, T1).
**Required safeguards:** size and type limits, content-type sniffing, virus scan, private storage (@vercel/blob) with expiring links, per-project storage cap, deletion with the ticket.
**Depends on:** the ticket system shipped and abuse protection proven in production.

## Reply to tickets by email (inbound email)
**What:** Customers reply from their mail app and the reply lands in the ticket.
**Why:** The familiar helpdesk flow. v1 is send-only; customers reply on a private ticket page (review D2, T2).
**Needs:** a provider with inbound parsing, per-ticket reply address for threading, quote and signature stripping, bounce and auto-reply handling, spam filtering.
**Trigger:** customers repeatedly ask to reply by email, or owners find the ticket page a barrier.
**Depends on:** send-only email from v1.

## Bring the app's accent to the 4.5:1 contrast minimum
**What:** Use the darker emerald (#047857, 5.48:1 with white) for text, links and filled buttons across the existing app.
**Why:** The app's emerald #059669 with white text measures 3.77:1, below the 4.5:1 minimum for normal text. The ticket screens use the darker green (design review 2026-10-18, decision 6C), so old and new screens differ in shade until this is done.
**Pros:** accessible everywhere, one accent token. **Cons:** touches every existing screen.
**Depends on:** DESIGN.md written (design review decision 5B) so the token has one home.

## Support tickets (shipped 2026-10-18), follow-ups
- Attachments on tickets (screenshots): needs file storage (Vercel Blob is installed) plus scanning; v1 is text only.
- Inbound email (customers replying to the notification email): needs an inbound mail provider; v1 is send-only and replies happen on the private ticket page.
- Phones: the widget's send button is not pinned above the on-screen keyboard yet (design review 6A); it scrolls with the form.
- Replies by customer after "resolved" reopen the ticket; consider a polite auto-close after N days of silence.
- Assignment, canned replies, SLA timers, analytics, multi-language widget: not built.
- Re-run `npm run support:eval` (live model, costs a few cents) after changing src/lib/support/ai.ts or the model.
