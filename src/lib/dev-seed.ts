import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { assembleContext, type Knowledge } from "./knowledge";

// The sample data of the local database (src/lib/db-pglite.ts): one owner with a project and an idea in every stage of
// the journey, plus a second person's idea to prove it never shows. Only ever loaded into an in-memory database.
export const DEV_USER = { email: "dev@ideahq.test", password: "dev-password-local-only", name: "Dev Owner" };

const PLAN = "## Change\nDo the thing.\n\n## Done when\nIt works.";

export async function seedDevData(db: PrismaClient): Promise<void> {
  const base = Date.UTC(2026, 9, 1, 9, 0, 0);
  let n = 0;
  const at = () => new Date(base + ++n * 60_000); // each row a minute newer than the last, so the order is always the same

  await db.user.create({ data: { id: "u1", email: DEV_USER.email, name: DEV_USER.name, approved: true, password: await bcrypt.hash(DEV_USER.password, 4) } });
  await db.user.create({ data: { id: "u2", email: "other@ideahq.test", name: "Someone Else", approved: true, password: await bcrypt.hash("other-password-local-only", 4) } });
  await db.githubInstallation.create({ data: { userId: "u1", id: 5, repos: ["acme/app"] } });
  // The project knowledge as it goes stale in real life: every topic confirmed a while ago, and a later scan that found
  // something different for one of them (waiting as a suggestion, never applied by itself).
  const old = "2026-10-01T09:00:00.000Z";
  const knowledge: Knowledge = {
    sections: {
      what: { text: "A small online shop for handmade soap.", source: "you", status: "confirmed", updatedAt: old },
      stack: { text: "Next.js, Prisma and Postgres.", source: "learn-run", status: "confirmed", updatedAt: old },
      structure: { text: "- `prisma/schema.prisma`: models User, Product, Order.\n- `src/app/`: the shop pages.", source: "learn-run", status: "confirmed", updatedAt: old },
    },
    proposals: {
      structure: { text: "- `prisma/schema.prisma`: models User, Product, Order, SupportTicket, TicketMessage, GiftCard.\n- `src/app/`: the shop pages and a support inbox.\n- Scheduled jobs: a daily clean-up of old tickets (vercel.json).", source: "learn-run", at: "2026-10-22T09:00:00.000Z" },
    },
    learnedSha: "abc123",
    learnedAt: "2026-10-22T09:00:00.000Z",
  };
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Acme", slug: "acme", context: assembleContext(knowledge), knowledge: knowledge as never, knowledgeBehind: 2, installationId: 5, repoOwner: "acme", repoName: "app", workflowInstalled: true } });
  await db.project.create({ data: { id: "p2", userId: "u2", name: "Theirs", slug: "theirs", context: "Not yours." } });

  const idea = (id: string, title: string, o: Record<string, unknown> = {}) => db.idea.create({ data: { id, userId: "u1", projectId: "p1", title, createdAt: at(), ...o } });
  const planned = { complexity: "S", plan: PLAN, scope: "A few lines." };

  await idea("n1", "Imported idea one", { notes: "From a backlog import" }); //       Describe: Plan it
  await idea("n2", "Imported idea two"); //                                          Describe: Plan it
  await idea("n3", "Imported idea three", { complexity: "M", scope: "Some files" }); // Describe: Plan it (sized, no plan)
  await idea("big", "Rebuild the whole billing flow", { complexity: "XL", scope: "Everything" }); // Epic: Split it
  await idea("ready", "Add a footer link", planned); //                              Plan: Build it
  await idea("wait", "Waiting on the footer", { ...planned, blockedBy: ["ready"] }); // Plan: blocked
  await idea("busy", "Dark mode toggle", { ...planned, status: "building" }); //     Build: the AI is working
  await idea("failed", "Try me again", { ...planned, status: "building" }); //       Build: Try again
  await idea("rev", "Weekly email summary", { ...planned, complexity: "M", status: "building" }); // Review: checks running
  await idea("red", "Export to CSV", { ...planned, complexity: "M", status: "building" }); //        Review: fix it
  await idea("green", "Search box", { ...planned, status: "building" }); //         Review: Merge
  await idea("done", "Fix the typo", { ...planned, status: "done" }); //             Ship: Revert offered
  await idea("rv", "Revert pending", { ...planned, status: "done" }); //             Ship: a revert is waiting
  await idea("park", "Maybe later", { status: "parked" }); //                        Parked
  await idea("epic", "Big epic", { complexity: "XL", scope: "Split into steps" });
  await idea("k1", "Step one", { parentId: "epic", status: "done", complexity: "S" });
  await idea("k2", "Step two", { parentId: "epic", complexity: "S", blockedBy: ["k1"] });
  await db.idea.create({ data: { id: "theirs", userId: "u2", projectId: "p2", title: "Their secret idea", createdAt: at() } });

  const run = (id: string, ideaId: string | null, status: string, o: Record<string, unknown> = {}) =>
    db.run.create({ data: { id, userId: "u1", projectId: "p1", ideaId, kind: "implement", status, model: "claude-haiku-5-5", createdAt: at(), ...o } });
  await run("r-busy", "busy", "running", { startedAt: new Date(base) });
  await run("r-failed", "failed", "failed", { error: "The AI made no changes.", finishedAt: new Date(base) });
  await run("r-rev", "rev", "pr_open", { prNumber: 11, checksState: "pending", headSha: "sha-rev" });
  await run("r-red", "red", "pr_open", { prNumber: 12, checksState: "red", headSha: "sha-red" });
  await run("r-green", "green", "pr_open", { prNumber: 7, checksState: "green", headSha: "sha-green", baseBranch: "main", costUsd: 0.04, turns: 11, stageMs: { total: 312_000, ai: 140_000 } });
  await run("r-done", "done", "merged", { prNumber: 5, baseBranch: "main", costUsd: 0.03, turns: 9, stageMs: { total: 275_000, ai: 110_000 }, sizeAtRun: "S" });
  await run("r-rv", "rv", "merged", { prNumber: 6, baseBranch: "main", costUsd: 0.05, stageMs: { total: 400_000 }, sizeAtRun: "S" });
  await db.run.create({ data: { id: "r-rv-revert", userId: "u1", projectId: "p1", ideaId: "rv", kind: "revert", status: "pr_open", prNumber: 8, parentRunId: "r-rv", checksState: "green", createdAt: at() } });
  // Three finished Quick changes with no idea (it was deleted since): enough for "Your last 3 Quick changes took ...".
  for (const [i, turns, cost, total] of [[1, 8, 0.01, 250_000], [2, 9, 0.02, 300_000], [3, 12, 0.04, 410_000]] as const) {
    await run(`r-hist-${i}`, null, "merged", { sizeAtRun: "S", turns, costUsd: cost, stageMs: { total, ai: Math.round(total / 2) } });
  }
}
