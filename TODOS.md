# TODOS

## Tomorrow (added 2026-10-21)

### 1. Redesign the whole idea-to-merge flow, AI first
**What:** Rethink the entire flow as one: write an idea, size it, break it into stories, write the plan, implement, review, merge. Today it is a row of separate buttons (Estimate the build, Break into stories, Generate build prompt, Implement, Approve and run, Approve and merge) that grew one at a time.
**Why:** The flow was designed around a human developer working through stories. The product's point is that an AI builds it, so the flow should be shaped by how the AI works and what the owner needs to decide.
**Context:** Recent pain points to design against: a README line was offered Opus at high effort; a run used its 15 turns and failed with a misleading message; a run took 10 minutes with no sign of life; ideas had to be sized by hand before the AI may build them (added 2026-10-21).

### 2. Estimates in AI terms, not human hours
**What:** Replace the human-development framing of sizes. Today S/M/L/XL are labelled in hours of human work ("S, a few hours", in `ideas-shared.ts`) and the estimate prompt says "S = a few hours, 1-2 files, no schema change" (`api/ideas/[id]/estimate/route.ts`). A small idea is minutes of AI time.
**Why:** The size drives the model, effort and turn limit, so it should describe what the AI will do: expected minutes, turns and cost, plus how risky the change is. Hours of human work tell the owner nothing about that.
**Needs:** decide the new scale and wording; change the estimate prompt, the labels, the Value / effort board and Focus ranking, the Guide, and how a size maps to a tier (src/lib/runs/policy.ts).

### 3. Design and tech stack review
**What:** A proper review of the product design (screens, the notebook theme, the first-run journey) and of the technology stack, before more is built on top.
**Context:** Stack today: Next.js 15 and React 19, Prisma 7 on Neon Postgres, next-auth, Tailwind, Vercel, GitHub App plus Actions workflow for the AI runs. Run /plan-design-review and /plan-eng-review on the redesign in items 1 and 2.

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

## Paywall: switching it on (built 2026-10-20, off until PAYWALL_ENABLED=1)
**What:** Lemon Squeezy billing is built and dormant. Pro (99 kr/month) and a 50-run pack; Admin has Free access and Run credits per person.
**To switch on:** set LEMONSQUEEZY_WEBHOOK_SECRET, LEMONSQUEEZY_PRO_URL, LEMONSQUEEZY_CREDITS_URL in Vercel, add the webhook in Lemon Squeezy (https://ideahq.cloud/api/billing/lemonsqueezy/webhook, events: subscription_*, order_created, order_refunded), test in test mode, give friends and family "Free access" in Admin, then set PAYWALL_ENABLED=1. Before that: clear Pro/credits that test purchases gave your own test account (Admin), swap in the live checkout links, live-mode webhook and secret, and (recommended) set LEMONSQUEEZY_STORE_ID and the two variant ids. Test-mode events are ignored once the paywall is on unless LEMONSQUEEZY_ACCEPT_TEST=1.
**Later:** refunds are not automated (switching off Pro does not refund; refund in Lemon Squeezy, and the webhook takes a refunded pack back); a one-off pack bought in test mode shares the live webhook (test events are accepted); Support tickets are still a manual Admin toggle (not part of Pro); the wording "Ask the owner" still shows for people the owner switched off; failed-payment emails come from Lemon Squeezy only.

## Give Preview deploys their own database
**Done (2026-10-21):** the build (`scripts/build.mjs`) only changes the schema on a production deploy, and never accepts data loss unless `ALLOW_DATA_LOSS=1` is set for that deploy. Preview deploys now use their own Neon branch (`preview`, schema only, no real data) through a Preview-only `DATABASE_URL`, their own `NEXTAUTH_SECRET`, and no `ANTHROPIC_API_KEY`. Production variables are Production only.
**Remember:** the preview branch does not get schema changes automatically (preview builds leave the schema alone). After a schema change, refresh it in Neon (reset the `preview` branch from production, schema only) before testing a preview of that change.

## Let me test pages behind sign-in (local test mode, then staging)
**What:** A way to test everything behind the login without using real accounts or the live database.
**Step 1, local test mode (do first):** one command starts Idea HQ locally on an in-memory Postgres (PGlite, already a dev dependency) with seeded test accounts (owner, friend) and sample data: projects at different setup stages, ideas, bugs, runs, tickets, What's new entries. Needs a local switch in `src/lib/db.ts` (an adapter for a plain Postgres connection instead of Neon) and fakes for GitHub, Lemon Squeezy, Resend and Anthropic. Then record repeatable click-through checks (phone and desktop widths, dark mode) so a page behind sign-in that breaks is caught before shipping.
**Step 2, staging site (when onboarding real customers):** `staging.ideahq.cloud` with its own Neon branch, its own Vercel environment variables and seeded test accounts, using sandbox modes (Lemon Squeezy test mode, a test Resend domain). This also fixes "Stop preview builds from changing the production database" below. Needs from the owner: a Neon branch, Vercel settings, the staging address.
**Not an option:** signing in to the live site. It holds friends' real data, and passwords are never typed on anyone's behalf.
**Pros:** catches regressions behind sign-in; no risk to live data. **Cons:** fakes cannot prove the real GitHub, payment or email services work.
**Depends on:** nothing. About a day for step 1.
