// A real Postgres (PGlite, in memory) behind the real Prisma client, for tests
// that must see true SQL behaviour: NULL handling, conditional updates, groupBy.
// The schema comes from prisma/schema.prisma via `prisma migrate diff`.
import { execFileSync } from "child_process";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

function schemaSql(): string {
  const out = execFileSync("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused" },
  });
  return out.slice(out.indexOf("-- CreateSchema") >= 0 ? out.indexOf("-- CreateSchema") : out.indexOf("-- CreateTable"));
}

export const pg = new PGlite();
export const db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
const ready = pg.exec(schemaSql());

// Empty every table between tests.
export async function resetDb(): Promise<void> {
  await ready;
  await pg.exec(`TRUNCATE "User", "RateBucket" CASCADE`);
}
