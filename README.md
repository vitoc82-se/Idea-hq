# Idea HQ

One backlog for all your projects. Capture an idea, tag it to a project, and the
AI estimates its effort/value and writes a ready-to-paste build prompt — grounded
in **that project's** real architecture, not a generic guess.

Lifted from the Snapmeal ideas board and made multi-project: each `Project` carries
its own `context` (its ARCHITECTURE.md / stack / models / deploy flow), which is the
exact text handed to Claude when it estimates or plans an idea for that project.

## Stack
Next.js 14 (App Router) · Prisma 7 → Neon Postgres · NextAuth (credentials + optional Google) · Anthropic Claude Opus 5 · Tailwind · deployed on Vercel.

## Getting started
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`, `OWNER_EMAIL`.
3. `npx prisma db push` to create the schema in your Neon database.
4. `npm run dev`, open http://localhost:3000, register (the first account becomes the owner).
5. Go to **Projects**, add each project and paste its context (its `ARCHITECTURE.md`).
6. Go to **Ideas**, capture an idea under a project — the estimate fills in automatically.

## Deploy
Set the same env vars in Vercel, then `git push origin main`. The build runs
`prisma db push` (additive schema changes only). The build (`scripts/build.mjs`) runs it only on a production deploy, without `--accept-data-loss`: a change that would drop data fails the build and the live site stays as it was. To drop something on purpose, set `ALLOW_DATA_LOSS=1` for that one deploy and remove it afterwards. Preview and local builds never change the schema.

## Layout
- `src/app/(app)/ideas` — the board (list + kanban), detail page, shared helpers
- `src/app/(app)/projects` — project admin (the per-project context lives here)
- `src/app/api/ideas/[id]/estimate` — AI effort/value/tags/scope
- `src/app/api/ideas/[id]/plan` — AI build prompt for a coding agent
- `src/lib/project-context.ts` — turns a project's context into the AI grounding block

## Implement with AI (GitHub App + Actions)

The **Implement** button on an idea runs Claude Code in the project's own GitHub repo (in that repo's GitHub Actions, with that repo's `ANTHROPIC_API_KEY` secret), then opens a pull request. Idea HQ only dispatches the run and listens to GitHub webhooks. See the eng review in `~/.gstack/projects/vitoc82-se-Idea-hq/` for the design.

### One-time server setup: create the GitHub App

GitHub, Settings, Developer settings, GitHub Apps, New GitHub App:

- **Homepage URL / Webhook URL:** `https://ideahq.cloud/api/github/webhook`
- **Webhook secret:** a long random string (`GITHUB_WEBHOOK_SECRET`)
- **Setup URL:** `https://ideahq.cloud/api/github/callback`, and tick **Request user authorization (OAuth) during installation**
- **Repository permissions:** Contents: Read and write. Pull requests: Read and write. Workflows: Read and write. Actions: Read and write. Commit statuses: Read. Checks: Read. Secrets: Read (existence check only). Metadata: Read.
- **Subscribe to events:** Workflow run, Pull request, Check suite, Check run, Status
- **Where can this app be installed:** Any account (or only you, for a private start)

Then generate a private key and a client secret, and set these in Vercel:

| Variable | Value |
|---|---|
| `GITHUB_APP_ID` | numeric App ID |
| `GITHUB_APP_SLUG` | the app's URL slug (also used as `allowed_bots` in the workflow) |
| `GITHUB_APP_PRIVATE_KEY` | the PEM, with newlines as `\n` |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | from the app page (install-ownership check) |
| `GITHUB_WEBHOOK_SECRET` | same string as in the app |
| `AI_DAILY_LIMIT` | optional, per-user daily estimate/plan/breakdown calls (default 20) |

### Per project

1. Projects, **GitHub**: connect, pick the repo, map environments to branches, set build/test commands.
2. **Open setup PR** and merge it in the repo (adds `.github/workflows/idea-hq.yml`).
3. In the repo add the Actions secret `ANTHROPIC_API_KEY`.
4. On an idea: generate the build prompt, then **Implement**, approve the plan, review the PR, **Approve and merge**.

### Access

New accounts are locked out until the owner approves them under **Users**. The owner is `OWNER_EMAIL` (or the first account).

### Tests

`npm test` (Vitest) and CI (`.github/workflows/ci.yml`) run the access matrix, the run engine against a fake GitHub, and the webhook/workflow helpers.

## AI limits and AI build (admin panel)
- `AI_DAILY_LIMIT` is the site default for helper AI calls (estimates, plans, drafts) per person per UTC day. Unset, empty, junk or `0` all mean the default of 20; it cannot switch AI off.
- Per person, the Admin page sets `aiDailyLimit`: empty = the site default, a number = that many a day, `0` = off (this also turns off AI answers in that person's Support widgets). The owner is never limited.
- `aiBuild` (per person, default on) allows the Implement and Learn deeply buttons and the Support "Add it for me" install. Merge, revert and cancel stay available when it is off, and runs already in flight finish.
- Rolling back the two User columns (`aiBuild`, `aiDailyLimit`) would drop their data (`prisma db push --accept-data-loss`).

## Billing (Lemon Squeezy) — off until `PAYWALL_ENABLED=1`
- Two products: **Pro** (subscription, AI build without a run limit, helper AI limit lifted to 500 a day) and a **runs pack** (one payment, 50 AI runs). Checkout links live in `LEMONSQUEEZY_PRO_URL` and `LEMONSQUEEZY_CREDITS_URL`; Idea HQ tags each link with the person's id and what is bought, so payments land on the right account (matching is by that id, never by email).
- Webhook: `POST /api/billing/lemonsqueezy/webhook`, signed with `LEMONSQUEEZY_WEBHOOK_SECRET` (HMAC-SHA256 of the raw body). Subscriptions only move forward in time (late events are ignored); a pack is recorded in `BillingEvent` so retries never grant it twice; a refund takes the pack back once.
- Test-mode purchases (`meta.test_mode`) are ignored (still answered 200) once `PAYWALL_ENABLED=1`, so a fake-card order can never grant Pro or runs in production. To rehearse the flow with a test card after payments are on, set `LEMONSQUEEZY_ACCEPT_TEST=1` for the test and remove it afterwards. Optional pins `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_PRO_VARIANT_ID`, `LEMONSQUEEZY_CREDITS_VARIANT_ID` (comma separated) make the webhook ignore any other store or product.
- With the paywall on, starting AI build needs the owner, Free access (set per person in Admin), Pro, or a credit. A credit is spent when a run is approved and returned if the run fails. Revise, merge, revert and cancel never need a credit. The Admin "AI build" switch still beats everything.
- Rollback: unset `PAYWALL_ENABLED`; everything behaves as before. The new columns are additive.
- Switching someone off: Admin shows **Switch off Pro** per person (with a confirm step). It sets `proRevokedAt`, which beats any Lemon Squeezy status and survives new purchases until **Restore Pro** is pressed. If `LEMONSQUEEZY_API_KEY` is set (optional), Idea HQ also cancels the subscription at Lemon Squeezy so they are not charged again; without the key, Admin says to cancel it in the Lemon Squeezy dashboard (it links to the subscription). Runs from a pack and Free access are separate controls.

## Notifications, spend cap, preview links, bugs and the public page
- **Email:** `src/lib/notify.ts` emails the run's owner when a PR opens, a revision finishes or a run fails (fired from `transition()` in the run engine, so once per real change). Off per person in Settings (`User.notifyEmail`). Uses the same Resend setup as Support.
- **Spend and cap:** `src/lib/spend.ts`. Month = UTC calendar month; counts implement and learn runs' reported `costUsd`. `Project.monthlyCapUsd` is checked before start, approve, revise and learn (a running run can finish over). OpenAI runs report no cost and show as "cost not reported".
- **Preview link:** `src/lib/preview.ts` reads the PR's bot comments (Vercel, Netlify, Cloudflare Pages and similar) for a preview address on an allow-listed host. Only GitHub App (bot) comments count. Needs no new GitHub permission (Pull requests: read). Stored on `Run.previewUrl`, re-checked at most every 45 s until found.
- **Bugs:** `Idea.kind` (`idea` | `bug`), `severity`, `repro`. Bugs use a reproduce-first plan prompt (`runs/plan-prompt.ts`) and build prompt; "no changes" on a bug reads as "could not reproduce" (credit refunded as for any failed run). Support tickets link to an idea with `Ticket.ideaId` (many tickets to one). `src/lib/issues.ts` holds draft-from-ticket, create/link/unlink, and tell-the-customers (once per idea, claimed with a conditional update).
- **What the AI said:** workflow v6 prints the AI's final message at the end of the "Report result" step, every line prefixed with `IDEAHQ-NOTE|` (so nothing in it can act as a workflow command). `runs/note.ts` reads it back from the job log (`GitHubApi.runNote`) into `Run.agentNote`; the run panel shows it, the PR description quotes it, and failure emails include it. Older workflows simply have no note. Failed runs also name the failing step (`runs/failure.ts`).
- **Freshness:** `src/lib/freshness.ts` caches for an hour per project how many commits the repo is ahead of the AI's knowledge (`STALE_COMMITS` = 20) and which workflow version is installed (`Project.knowledgeBehind`, `workflowVersionSeen`). Shown on Projects, the knowledge page and above the plan on an idea. A workflow update is offered, never forced (`workflowUpdateAvailable`).
- **What's new page:** `/changes/[key]`, public, walled like Support (`src/lib/changelog/public-store.ts` is its only database access; `tests/changelog-isolation.test.ts`). Merged implement runs create a draft `ChangelogEntry`; the owner words and publishes it. Idea HQ's own Help button is not loaded on these pages.

## Who is the owner (and why the email is normalized)
- The owner is a specific **account**: the oldest account holding `OWNER_EMAIL` (letters may differ in case, nothing else), or the first account when `OWNER_EMAIL` is unset (`src/lib/owner.ts`). It is never "whoever shows that address", because anyone can register a lookalike such as `OWNER@x.se`.
- Sign-up stores emails trimmed and lower case, refuses an address that already exists in any letters, and sign-in matches case-insensitively. Admin flags accounts whose email looks like another's and lets the owner remove them (`tests/account-email.test.ts`).
- Sign-in and sign-up have brakes (`src/lib/auth-limits.ts`, counters in the shared `RateBucket` table): 8 wrong passwords per address+email per 15 minutes, 40 per address, 100 per email per hour; 5 sign-ups per address and 3 tries per email per hour. A "too many attempts" answer comes before any password is hashed. Unknown emails still spend a bcrypt check, so timing does not reveal who has an account. Passwords are 8 to 72 bytes.
- Sign-up needs the Cloudflare Turnstile check (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`; fails closed in production). `REGISTER_CAPTCHA=off` is the emergency switch if Turnstile is down.
- Sign-up emails a signed link (`src/lib/email-verification.ts`, 3 days, tied to the exact address, confirmed with a button/POST). The owner is asked before approving someone who has not confirmed (Google sign-in counts as confirmed).

## Workflow versions
`src/lib/runs/workflow.ts` writes the GitHub Actions file into each project (`WORKFLOW_VERSION`). `tests/workflow-yaml.test.ts` parses every generated variant, because version 6 shipped with invalid YAML and GitHub mailed a failure on every push. A version known to be broken goes in `BROKEN_WORKFLOW_VERSIONS`: such a project counts as having no usable workflow and is asked to update.

### Workflow v8 (how the AI is kept away from credentials)
Two jobs: `implement` (AI key, read-only repo token, shell sandbox via `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, which needs `bubblewrap`, `socat` and Ubuntu's user namespaces allowed) hands its changes over as a patch artifact; `publish` (write token, no AI key, never runs the AI) applies it to a clean checkout, runs build and tests, pushes the branch and posts the status. Checkouts store no credentials, the token is passed per git command, and the AI cannot read `.git`. Shell allow-list: `npm test`, `npm run`, `npm ls`, `npm install/ci --ignore-scripts`, a few checkers via `npx`, `ls`, `git diff/status`. `tests/workflow-yaml.test.ts` pins all of it; v8 was verified live with cheap Haiku runs. Idea HQ reads the AI's note from the last job's log. Older versions keep working and are offered the update (v6 is treated as broken).

### Public repos and secret files (H2, M8)
`Project.repoPrivate` (from GitHub's `private` flag, refreshed when the setup page loads) drives a public-repo notice on project setup and in the ticket-to-bug form. Tickets turned into ideas have emails and phone numbers removed unless the repo is known private (`src/lib/runs/public-safe.ts`, `src/lib/issues.ts`); the plan, prompt and PR text are not rewritten, because legitimate ideas can contain addresses. The run inputs and Actions logs of a public repo are readable by anyone: that cannot be hidden. Secret-type files are skipped by the knowledge scanner (`SECRETISH`/`SECRET_DIRS` in `src/lib/repo-snapshot.ts`) and denied to the AI in the workflow (`CLAUDE_DISALLOWED_TOOLS` in `src/lib/providers/claude.ts`); a deny rule also blocks creating such a file. Workflow v9 pins every action to an exact commit (`src/lib/runs/action-pins.ts`); bump them there, and Dependabot (`.github/dependabot.yml`) covers npm and this repo's own actions.

### Sessions (M1)
Sessions are signed JWT cookies. `User.sessionVersion` is copied into the token at sign-in and checked on every session read (`assertSessionCurrent` in `src/lib/sessions.ts`, called from the `session` callback; a mismatch throws, so next-auth answers "no session" and clears the cookie). A password change and `POST /api/auth/revoke-sessions` ("Sign out on all devices" in Settings) bump it, which signs out every device. Older cookies without a number count as version 0 and keep working until the first bump. Change-password is rate limited (8 attempts per person and 30 per address per 15 minutes) and caps passwords at 72 bytes. `tests/session-revocation.test.ts`.

### Service worker (M2)
`public/sw.js` caches only public files (`/_next/static/`, `/icons/`, the manifest, `/offline.html`) and never pages or API data; a page request goes to the network and shows `/offline.html` when there is none. The cache name was bumped to `idea-hq-v2`, so the activate step deletes the old `idea-hq-v1` cache, which held signed-in pages. `tests/service-worker.test.ts` runs the worker against a fake browser.
