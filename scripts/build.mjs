// The build, with one safety rule: only a PRODUCTION deploy may change the database schema.
// Preview deploys (every branch/PR) and local builds share DATABASE_URL with production, so they
// must never run `prisma db push`.
//
// Production also refuses changes that would drop data. A deliberate drop is done by setting
// ALLOW_DATA_LOSS=1 for that one deploy (and removing it again afterwards).
//
//   node scripts/build.mjs            runs the build
//   node scripts/build.mjs --dry-run  prints the steps it would run
import { spawnSync } from "node:child_process";

export function buildSteps(env) {
  const steps = [["prisma", "generate"]];
  if (env.VERCEL_ENV === "production") {
    steps.push(env.ALLOW_DATA_LOSS === "1" ? ["prisma", "db", "push", "--accept-data-loss"] : ["prisma", "db", "push"]);
  }
  steps.push(["next", "build"]);
  return steps;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const steps = buildSteps(process.env);
  if (process.argv.includes("--dry-run")) {
    for (const s of steps) console.log(s.join(" "));
  } else {
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      console.log(`Preview/other build (${process.env.VERCEL_ENV}): the database schema is left alone.`);
    }
    for (const [cmd, ...args] of steps) {
      const r = spawnSync("npx", ["--no-install", cmd, ...args], { stdio: "inherit", env: process.env });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
  }
}
