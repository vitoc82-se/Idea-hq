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
