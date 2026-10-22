// The database for running Idea HQ on your own machine with nothing to set up: Postgres in memory (PGlite) behind the
// real Prisma client, with the schema from prisma/schema.prisma and the sample data from dev-seed.ts. It is switched on by
// `IDEAHQ_DB=pglite` (see scripts/local.mjs), which makes the build use this file in place of ./db (next.config.mjs), so
// the real database code and this one never ship together. Everything is lost when the server stops.
import { execFileSync } from "child_process";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { logError } from "./log";
import { seedDevData } from "./dev-seed";

// Never on a deployment: there the data must be the real database's.
if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Error("IDEAHQ_DB=pglite is for local development only.");

type Local = { real: PrismaClient; ready: Promise<void> };
const g = globalThis as unknown as { __ideahqLocalDb?: Local };

function start(): Local {
  const pg = new PGlite();
  const real = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  const ready = (async () => {
    const sql = execFileSync("npx", ["--no-install", "prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused" },
    });
    await pg.exec(sql.slice(sql.indexOf("-- CreateTable")));
    await seedDevData(real);
  })();
  // A failed start must show up on every query, not hang them.
  ready.catch((e) => logError("local database could not start", e));
  return { real, ready };
}
const local = g.__ideahqLocalDb ?? (g.__ideahqLocalDb = start());

// Every call waits for the schema and the sample data, so the first request after a start is just a little slower.
function afterReady<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, key) {
      const value = Reflect.get(t, key, t) as unknown;
      if (typeof value === "function") return (...args: unknown[]) => local.ready.then(() => (value as (...a: unknown[]) => unknown).apply(t, args));
      return value && typeof value === "object" ? afterReady(value as object) : value;
    },
  });
}

export const db: PrismaClient = afterReady(local.real);
