import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// The public What's new page has no login, so it is walled off like the support pages:
// the page and the social image reach the database only through one small store that
// reads a project's name and its published entries, and nothing else.
const SRC = path.resolve(__dirname, "../src");
const STORE = path.join(SRC, "lib/changelog/public-store.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(SRC, "app/changes")), STORE, path.join(SRC, "lib/changelog/kinds.ts")];
const importsOf = (f: string) => Array.from(fs.readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)).map((m) => m[1]);
const ALLOWED = new Set(["next/navigation", "next", "next/og", "react", "@/lib/changelog/public-store", "@/lib/changelog/kinds", "@/lib/db"]);

describe("the public What's new page is walled off", () => {
  it("finds the files", () => expect(files.length).toBeGreaterThanOrEqual(4));
  for (const f of files) {
    const rel = path.relative(SRC, f);
    it(`${rel} imports only the store, the constants and a few framework modules`, () => {
      for (const imp of importsOf(f)) {
        if (imp.startsWith(".")) continue;
        if (imp === "@/lib/db") {
          expect(f, `${rel} must not touch the database directly`).toBe(STORE);
          continue;
        }
        expect(ALLOWED.has(imp), `${rel} imports ${imp}`).toBe(true);
      }
    });
  }
  it("the store reads only the project name and published entries", () => {
    const src = fs.readFileSync(STORE, "utf8");
    const models = new Set(Array.from(src.matchAll(/\bdb\.([A-Za-z$]+)/g)).map((m) => m[1]));
    expect(Array.from(models)).toEqual(["project"]);
    for (const forbidden of ["context", "knowledge", "installationId", "repoOwner", "envBranches", "idea", "run", "ticket", "memory", "userId", "plan"]) {
      expect(new RegExp(`\\b${forbidden}\\b`).test(src.replace(/\/\/.*$/gm, "")), `store mentions ${forbidden}`).toBe(false);
    }
    expect(src).toMatch(/publishedAt: \{ not: null \}/);
    expect(src).toMatch(/changelogOn: true/);
  });
  it("nothing in the public code logs", () => {
    for (const f of files) expect(fs.readFileSync(f, "utf8"), path.relative(SRC, f)).not.toMatch(/console\./);
  });
});
