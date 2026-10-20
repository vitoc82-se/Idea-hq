import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// Preview deploys and local builds share DATABASE_URL with production. Only a production deploy
// may touch the schema, and never in a way that drops data unless that is asked for on purpose.
const steps = (env: Record<string, string | undefined>) =>
  execFileSync("node", ["scripts/build.mjs", "--dry-run"], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8" }).trim().split("\n");

describe("build script", () => {
  it("production: generates, pushes the schema WITHOUT accepting data loss, then builds", () => {
    expect(steps({ VERCEL_ENV: "production" })).toEqual(["prisma generate", "prisma db push", "next build"]);
  });
  it("production: dropping data needs ALLOW_DATA_LOSS=1 on purpose", () => {
    expect(steps({ VERCEL_ENV: "production", ALLOW_DATA_LOSS: "1" })).toContain("prisma db push --accept-data-loss");
    expect(steps({ VERCEL_ENV: "production", ALLOW_DATA_LOSS: "yes" })).not.toContain("prisma db push --accept-data-loss");
  });
  it("preview deploys never touch the schema, whatever else is set", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "preview", ALLOW_DATA_LOSS: "1" }, { VERCEL_ENV: "development" }, {}, { VERCEL_ENV: "" }]) {
      const s = steps(env);
      expect(s, JSON.stringify(env)).toEqual(["prisma generate", "next build"]);
    }
  });
  it("package.json uses the script and nothing else pushes on build", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toBe("node scripts/build.mjs");
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/accept-data-loss/);
  });
});
