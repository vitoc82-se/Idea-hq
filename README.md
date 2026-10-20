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
`prisma db push` (additive schema changes only).

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
- With the paywall on, starting AI build needs the owner, Free access (set per person in Admin), Pro, or a credit. A credit is spent when a run is approved and returned if the run fails. Revise, merge, revert and cancel never need a credit. The Admin "AI build" switch still beats everything.
- Rollback: unset `PAYWALL_ENABLED`; everything behaves as before. The new columns are additive.
