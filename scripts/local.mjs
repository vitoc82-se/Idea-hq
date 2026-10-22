// Runs Idea HQ on your own machine against an in-memory database with sample data (src/lib/db-pglite.ts), so there is
// nothing to set up: no Neon, no GitHub, no AI key. Sign in as dev@ideahq.test with dev-password-local-only.
//
//   node scripts/local.mjs dev      the dev server (what `npm run dev:local` runs)
//   node scripts/local.mjs build    a production build for it (what the smoke tests run against)
//   node scripts/local.mjs start    serve that build
//
// The AI key is blanked, so no call can spend anything, unless IDEAHQ_ALLOW_AI=1. The port is 3100 (PORT to change it).
import { spawn } from "node:child_process";

const [command = "dev"] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(command)) {
  console.error(`Unknown command "${command}". Use dev, build or start.`);
  process.exit(2);
}
const port = process.env.PORT || "3100";
const env = {
  ...process.env,
  IDEAHQ_DB: "pglite",
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "local-secret-for-the-in-memory-database-only",
  NEXTAUTH_URL: `http://localhost:${port}`,
  OWNER_EMAIL: "dev@ideahq.test",
  ...(process.env.IDEAHQ_ALLOW_AI === "1" ? {} : { ANTHROPIC_API_KEY: "" }),
};
const args = ["--no-install", "next", command, ...(command === "build" ? [] : ["-p", port])];
const child = spawn("npx", args, { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
