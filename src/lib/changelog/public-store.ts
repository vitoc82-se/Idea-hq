import { db } from "@/lib/db";

// The only database access for the public "What's new" page (no login). It reads one
// project's name and its PUBLISHED entries, nothing else: no ideas, plans, runs, repo or
// customer data. tests/changelog-isolation.test.ts keeps it that way.

const KEY = /^ihq_c_[A-Za-z0-9_-]{16}$/;

export type PublicEntry = { id: string; kind: string; title: string; body: string | null; publishedAt: Date };
export type PublicChangelog = { name: string; entries: PublicEntry[] };

export async function loadChangelog(key: string): Promise<PublicChangelog | null> {
  if (!KEY.test(key)) return null;
  const p = await db.project.findFirst({
    where: { changelogKey: key, changelogOn: true },
    select: {
      name: true,
      changelogEntries: {
        where: { publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        take: 100,
        select: { id: true, kind: true, title: true, body: true, publishedAt: true },
      },
    },
  });
  if (!p) return null;
  return { name: p.name, entries: p.changelogEntries.filter((e): e is PublicEntry => e.publishedAt !== null) };
}
