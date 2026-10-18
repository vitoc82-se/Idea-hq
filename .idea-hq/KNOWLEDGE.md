# Idea HQ: project knowledge

## What it is and who it is for
Idea HQ is one backlog for all of a person's software projects. You capture an idea under a project, and the AI estimates its size and value, writes a build plan grounded in that project's own description, and can then implement it as a GitHub pull request. It is used by its owner and by friends the owner approves (access is invite-only).

## Technology
- TypeScript, Next.js 14 (App Router), React 18, Tailwind CSS.
- Prisma 7 with a Neon Postgres database (`@prisma/adapter-neon`).
- NextAuth: email and password, plus optional Google sign-in.
- Anthropic SDK for the AI; a GitHub App for repository access.
- Hosted on Vercel. Tests use Vitest; zod, lucide-react and recharts are also installed.

## How it is organised
- `src/app/(app)/`: signed-in pages: `ideas` (board, kanban, detail, run panel), `projects` (admin, repo, `[id]/setup`, `[id]/knowledge`), `users`.
- `src/app/api/`: server routes for ideas, projects, runs, onboarding, admin users and `github` (install, callback, webhook).
- `src/app/`: public pages `page.tsx`, `guide`, `welcome`, `auth`.
- `src/lib/`: logic: `access.ts` (approval, daily AI limit), `knowledge*.ts`, `repo-snapshot.ts`, `repo-tools.ts`, `github/`, and `runs/` (engine, state, policy, workflow).
- `prisma/schema.prisma`: models User, Project, Idea, Run, ProjectMemory, GithubInstallation, WebhookDelivery, plus the NextAuth tables.
- `tests/`: Vitest tests with a fake database (`fakedb.ts`).

## How to run, test and ship
- Setup: `npm install`, copy `.env.example` to `.env` (`DATABASE_URL`, `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`, `OWNER_EMAIL`), then `npx prisma db push`.
- Start: `npm run dev` (http://localhost:3000).
- Check: `npm run typecheck`, `npm run lint`, `npm test`. CI (`.github/workflows/ci.yml`) runs `prisma generate`, then these three, on pull requests and pushes to `main`.
- Build: `npm run build` runs `prisma generate`, `prisma db push --accept-data-loss`, then `next build`.
- Ship: the README says to push to `main` and let Vercel deploy. I could not see the Vercel settings themselves.

## Rules and things not to touch
- Every API route and page checks the session and `canUse()` from `src/lib/access.ts`. Keep that on any new route.
- Run status changes must follow the table in `src/lib/runs/state.ts`; invalid ones are ignored.
- `.github/workflows/idea-hq.yml` is generated from `src/lib/runs/workflow.ts`. If you change the template, raise `WORKFLOW_VERSION`.
- Build and test commands must be one line (`safeCommand`).
- `src/generated/prisma` is generated and git-ignored. Never commit `.env`, keys or secrets.
- `.idea-hq/KNOWLEDGE.md` has fixed headings (`src/lib/knowledge.ts`). Keep them.

## Known quirks and lessons
- `npm run build` uses `prisma db push --accept-data-loss`, but the README calls the schema changes "additive only". Avoid removing or renaming columns.
- The README says Claude Opus 5; the real models are set in `src/lib/runs/policy.ts` (Haiku, Sonnet, Opus, Fable tiers).
- Only one AI run per project may be active at once, and server-paid AI calls are capped per user per day (`AI_DAILY_LIMIT`, default 20; the owner is exempt).
- Webhooks can arrive twice or out of order, which is why `WebhookDelivery` exists.
- `TODOS.md` lists planned work: other AI vendors and spend caps. I found no other recorded lessons.
