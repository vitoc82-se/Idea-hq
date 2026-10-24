# Idea HQ: project knowledge

## What it is and who it is for
Idea HQ is one backlog for all of a person's software projects. You capture an idea under a project, and the AI estimates its size and value, writes a build plan grounded in that project's own description, and can then implement it as a GitHub pull request. It is used by its owner and by friends the owner approves (access is invite-only). The top planned work is support for AI vendors other than Anthropic.

## Technology
- TypeScript, Next.js 14 (App Router), React 18, Tailwind CSS. Note: `package.json` currently lists Next.js `^15.5` and React `^19`, so check it before relying on version-specific features.
- Prisma 7 with a Neon Postgres database (`@prisma/adapter-neon`).
- NextAuth: email and password, plus optional Google sign-in.
- Anthropic SDK for the AI; a GitHub App for repository access.
- Hosted on Vercel. Tests use Vitest (Playwright for browser smoke tests); zod, lucide-react and recharts are also installed.
- Node 20 (`.nvmrc`).

## How it is organised
- `src/app/(app)/`: signed-in pages: `ideas` (board, kanban, detail, run panel), `projects` (admin, repo, `[id]/setup`, `[id]/knowledge`), `users`, plus `focus`, `settings`, `billing`, `support`.
- `src/app/api/`: server routes for ideas, projects, runs, onboarding, admin users and `github` (install, callback, webhook), plus `billing`, `cron`, `settings`, `support`, `tickets`.
- `src/app/`: public pages `page.tsx`, `guide`, `welcome`, `auth`, and `help`, `changes`, `embed`, `widget`.
- `src/lib/`: `access.ts` (approval, daily AI limit), `knowledge*.ts`, `repo-snapshot.ts`, `repo-tools.ts`, `github/`, `providers/` (claude, openai), `runs/` (engine, state, policy, workflow).
- `prisma/schema.prisma`: User, Project, Idea, Run, ProjectMemory, GithubInstallation, WebhookDelivery, support, billing and changelog tables, and the NextAuth tables.
- `tests/`: Vitest with a fake database (`fakedb.ts`); `e2e/`: Playwright.
- Docs: `README.md`, `DESIGN.md`, `SECURITY.md`, `BACKLOG.md`, `TODOS.md`.

## How to run, test and ship
- Setup: `npm install`, copy `.env.example` to `.env` (`DATABASE_URL`, `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`, `OWNER_EMAIL`), then `npx prisma db push`. The owner's local `.env` points at the live database, so local runs and `db push` act on live data.
- Start: `npm run dev` (http://localhost:3000). Safe alternative: `npm run dev:local` (in-memory database, sample data, no AI key; port 3100).
- Check: `npm run typecheck`, `npm run lint`, `npm test`. CI (`.github/workflows/ci.yml`) runs `prisma generate`, then these three, on pull requests and pushes to `main`, plus browser smoke tests (`npm run test:e2e`).
- Build: `npm run build` runs `scripts/build.mjs`: `prisma generate`, then `prisma db push` only on a Vercel production deploy (`--accept-data-loss` only if `ALLOW_DATA_LOSS=1`), then `next build`.
- GitHub features (connecting a repo, pull requests, webhooks) are tested only on the live site, not locally.
- Ship: the README says to push to `main` and let Vercel deploy. I could not see the Vercel settings themselves.

## Rules and things not to touch
- Every API route and page checks the session and `canUse()` from `src/lib/access.ts`. Keep that on any new route.
- Run status changes must follow the table in `src/lib/runs/state.ts`; invalid ones are ignored.
- `.github/workflows/idea-hq.yml` is generated from `src/lib/runs/workflow.ts`. If you change the template, raise `WORKFLOW_VERSION` (now 9).
- Build and test commands must be one line (`safeCommand`).
- `src/generated/prisma` is generated and git-ignored. Never commit `.env`, keys or secrets.
- `.idea-hq/KNOWLEDGE.md` has fixed headings (`src/lib/knowledge.ts`). Keep them.
- Whether the AI agent pushes to `main` or opens a pull request is the user's choice. Do not assume either.
- Always write tests for new features.

## Known quirks and lessons
- The build can run `prisma db push` against the live database, but the README calls schema changes "additive only". Avoid removing or renaming columns.
- The README and `.env.example` say Claude Opus 5; the real models are set in `src/lib/runs/policy.ts` and `src/lib/providers` (Haiku, Sonnet, Opus, Fable tiers).
- Only one AI run per project may be active at once, and server-paid AI calls are capped per user per day (`AI_DAILY_LIMIT`, default 20; the owner is exempt).
- Webhooks can arrive twice or out of order, which is why `WebhookDelivery` exists.
- Onboarding and project setup are a bit wonky. Expect rough edges and recheck them after changes.
- `TODOS.md` lists planned work: other AI vendors, spend caps, and a redesign of the idea-to-merge flow. An OpenAI provider already exists in `src/lib/providers`.
- Sizes (S/M/L/XL) are still worded as human hours, though they pick the AI model.
