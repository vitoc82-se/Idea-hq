import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

// The local mode (in-memory database with sample data) must never reach a deployment, and its sample data must keep
// telling the stories the smoke tests rely on.
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => (sess.user ? { user: sess.user } : null), getCurrentUserId: async () => sess.user?.id ?? null }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { seedDevData, DEV_USER } from "@/lib/dev-seed";
import { GET as listIdeas } from "@/app/api/ideas/route";
import { boardNext, needsYou, needsYouRank } from "@/lib/runs/journey";
import { readSteps, stepsLeft } from "@/lib/runs/owner-steps";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("the local database can never be the deployed one", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; vi.resetModules(); });

  it("refuses to start on Vercel, before any database is created", async () => {
    process.env.VERCEL = "1";
    await expect(import("@/lib/db-pglite")).rejects.toThrow(/local development only/);
    delete process.env.VERCEL;
    process.env.VERCEL_ENV = "preview";
    vi.resetModules();
    await expect(import("@/lib/db-pglite")).rejects.toThrow(/local development only/);
  });

  it("the normal database file knows nothing about it, and nothing else imports it", () => {
    expect(read("src/lib/db.ts")).not.toMatch(/pglite/i);
    const importers = fs.readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("generated") && !/^lib[\\/](db-pglite|dev-seed)\.ts$/.test(f))
      .filter((f) => /from\s+["'][^"']*(db-pglite|dev-seed)["']/.test(fs.readFileSync(path.join("src", f), "utf8")));
    expect(importers).toEqual([]); // only the local database file loads the sample data; no page, route or helper does
    expect(read("src/lib/db-pglite.ts")).toMatch(/from "\.\/dev-seed"/);
  });

  it("a normal build is configured exactly as before; only IDEAHQ_DB=pglite adds the swap", async () => {
    delete process.env.IDEAHQ_DB;
    vi.resetModules();
    const plain = (await import("../next.config.mjs")).default as Record<string, unknown>;
    expect(plain.webpack).toBeUndefined();
    expect(plain.serverExternalPackages).toBeUndefined();
    process.env.IDEAHQ_DB = "pglite";
    vi.resetModules();
    const local = (await import("../next.config.mjs")).default as Record<string, unknown>;
    expect(typeof local.webpack).toBe("function");
    expect(local.serverExternalPackages).toEqual(["@electric-sql/pglite", "pglite-prisma-adapter"]);
  });

  it("only the dev server may use eval; a build's policy is the strict one", async () => {
    const csp = async (env: string) => {
      vi.stubEnv("NODE_ENV", env);
      vi.resetModules();
      const cfg = (await import("../next.config.mjs")).default as unknown as { headers: () => Promise<{ headers: { key: string; value: string }[] }[]> };
      const value = (await cfg.headers())[0].headers.find((x) => x.key === "Content-Security-Policy")!.value;
      vi.unstubAllEnvs();
      return value;
    };
    expect(await csp("production")).not.toContain("unsafe-eval");
    expect(await csp("test")).not.toContain("unsafe-eval");
    expect(await csp("development")).toContain("'unsafe-eval'");
  });
});

describe("scripts/local.mjs", () => {
  const script = read("scripts/local.mjs");
  it("makes the owner the sample user, and blanks the AI key unless asked", () => {
    expect(script).toContain(`OWNER_EMAIL: "${DEV_USER.email}"`);
    expect(script).toMatch(/IDEAHQ_ALLOW_AI === "1" \? \{\} : \{ ANTHROPIC_API_KEY: "" \}/);
    expect(script).toContain('IDEAHQ_DB: "pglite"');
  });
  it("the npm scripts use it", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["dev:local"]).toBe("node scripts/local.mjs dev");
    expect(scripts["build:local"]).toBe("node scripts/local.mjs build");
    expect(scripts["test:e2e"]).toMatch(/^node scripts\/local\.mjs build && playwright test$/);
  });
});

describe("the sample data", () => {
  beforeEach(async () => { await resetDb(); await seedDevData(db); sess.user = { id: "u1", email: DEV_USER.email }; });

  it("has a working owner, and a second person whose idea never shows", async () => {
    const u = await db.user.findFirst({ where: { email: DEV_USER.email } });
    expect(await bcrypt.compare(DEV_USER.password, u!.password!)).toBe(true);
    const ideas = (await (await listIdeas(new Request("https://x/api/ideas"))).json()) as { title: string }[];
    expect(ideas.map((i) => i.title)).not.toContain("Their secret idea");
  });

  it("puts an idea in every stage, with seven waiting for the owner, most urgent first", async () => {
    const ideas = (await (await listIdeas(new Request("https://x/api/ideas"))).json()) as { id: string; title: string; status: string; complexity: string | null; plan: string | null; blockedBy: string[]; ownerSteps: unknown; latestRun: { status: string; checksState: string | null } | null; epic: { children: { id: string; status: string }[]; nextId: string | null } | null }[];
    const step = (i: (typeof ideas)[number]) => boardNext({ idea: i, run: i.latestRun, epic: i.epic, blockedBy: i.blockedBy.length ? ["x"] : [], stepsOpen: i.status === "done" ? stepsLeft(readSteps(i.ownerSteps)).length : 0 });
    const stages = new Set(ideas.map((i) => step(i).stageLabel));
    expect([...stages].sort()).toEqual(["Build", "Describe", "Parked", "Plan", "Review", "Ship"]);
    const waiting = ideas.filter((i) => needsYou(step(i))).sort((a, b) => needsYouRank(step(a)) - needsYouRank(step(b)));
    expect(waiting.map((i) => i.title)).toEqual(["Send a welcome email", "Search box", "Add a contact form", "Export to CSV", "Try me again", "Add a footer link", "Rebuild the whole billing flow"]);
  });

  it("has enough finished Quick changes for the own-history line", async () => {
    const done = await db.run.count({ where: { userId: "u1", kind: "implement", status: { in: ["merged", "pr_open"] }, turns: { not: null } } });
    expect(done).toBeGreaterThanOrEqual(3);
  });
});

describe("the smoke tests", () => {
  it("are kept apart from the unit tests and do not run in them", () => {
    const config = read("vitest.config.ts");
    expect(config).toContain('include: ["tests/**/*.test.ts"]');
    expect(fs.readdirSync("e2e").filter((f) => f.endsWith(".spec.ts")).length).toBeGreaterThanOrEqual(5);
  });
  it("run against the local build and never against a real address", () => {
    const config = read("playwright.config.ts");
    expect(config).toContain("scripts/local.mjs start");
    expect(config).toContain("http://localhost:");
    expect(config).not.toMatch(/ideahq\.cloud/);
  });
});
