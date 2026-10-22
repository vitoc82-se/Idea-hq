import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { routeFiles } from "./helpers";

// The wall around the public support surface. Customers (no login) can reach the
// widget, the ticket page and /api/support/*. Those files may touch the database
// only through src/lib/support/public-store.ts, and must never import project
// internals, runs, repo access or the owner-side modules.

const SRC = path.resolve(__dirname, "../src");
const SUPPORT_LIB = path.join(SRC, "lib/support");

// Owner-side modules: sign-in, project data, AI drafting. Never imported by public code.
const OWNER_LIB = new Set(["owner.ts", "owner-tickets.ts", "settings.ts", "notes-draft.ts", "retention.ts", "site-check.ts", "install.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const publicLib = fs.readdirSync(SUPPORT_LIB).filter((f) => f.endsWith(".ts") && !OWNER_LIB.has(f)).map((f) => path.join(SUPPORT_LIB, f));
const publicApp = [
  ...walk(path.join(SRC, "app/api/support")),
  ...walk(path.join(SRC, "app/widget")),
  ...walk(path.join(SRC, "app/help")),
  ...walk(path.join(SRC, "app/t")),
  ...walk(path.join(SRC, "app/embed")),
];
const publicFiles = [...publicLib, ...publicApp];

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  return Array.from(src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)).map((m) => m[1]);
}

const ALLOWED_EXTERNAL = new Set(["next/server", "crypto", "zod", "@anthropic-ai/sdk", "dns/promises", "net"]);

describe("the public support surface is walled off", () => {
  it("finds the public files (guards against an empty check)", () => {
    expect(publicApp.length).toBeGreaterThanOrEqual(7);
    expect(publicLib.length).toBeGreaterThanOrEqual(10);
    expect(publicFiles.some((f) => f.endsWith("public-store.ts"))).toBe(true);
  });

  for (const file of publicFiles) {
    const rel = path.relative(SRC, file);
    it(`${rel} imports only support code and a few safe libraries`, () => {
      for (const imp of importsOf(file)) {
        if (imp.startsWith(".")) {
          const target = path.basename(imp).replace(/\.ts$/, "") + ".ts";
          expect(OWNER_LIB.has(target), `${rel} imports owner-side ${imp}`).toBe(false);
          continue;
        }
        if (imp.startsWith("@/lib/support/")) {
          const target = imp.replace("@/lib/support/", "") + ".ts";
          expect(OWNER_LIB.has(target), `${rel} imports owner-side ${imp}`).toBe(false);
          continue;
        }
        if (imp === "@/lib/db") {
          expect(rel.endsWith("lib/support/public-store.ts"), `${rel} must not touch the database directly`).toBe(true);
          continue;
        }
        if (imp === "@/generated/prisma/client") continue;
        expect(ALLOWED_EXTERNAL.has(imp), `${rel} imports ${imp}`).toBe(true);
      }
    });
  }

  it("public-store reads and writes only the support tables", () => {
    const src = fs.readFileSync(path.join(SUPPORT_LIB, "public-store.ts"), "utf8");
    const models = new Set(Array.from(src.matchAll(/\b(?:db|tx)\.([A-Za-z$]+)/g)).map((m) => m[1]));
    for (const m of Array.from(models)) expect(["supportSpace", "ticket", "ticketMessage", "rateBucket", "$transaction", "$queryRaw"], `public-store touches ${m}`).toContain(m);
    // no project internals
    for (const forbidden of ["projectMemory", "knowledge", "installationId", "repoOwner", "envBranches", "contextUpdatedAt", "db.run", "db.idea", "db.project"]) {
      expect(src.includes(forbidden), `public-store mentions ${forbidden}`).toBe(false);
    }
    expect(/\bcontext\b\s*:/.test(src)).toBe(false);
  });

  it("the explicit allow-list of routes that need no login is complete", () => {
    const apiRoot = path.join(SRC, "app/api");
    const open = routeFiles(apiRoot)
      .map((f) => path.relative(apiRoot, f).replace(/\\/g, "/"))
      .filter((f) => f.startsWith("support/") || f.startsWith("cron/"))
      .sort();
    expect(open).toEqual([
      "cron/stuck-runs/route.ts",
      "cron/support-retention/route.ts",
      "support/space/[key]/ask/route.ts",
      "support/space/[key]/tickets/route.ts",
      "support/ticket/[token]/route.ts",
    ]);
  });

  it("every public page and API route checks the feature gate through the store", () => {
    for (const f of publicApp.filter((x) => x.endsWith("route.ts"))) {
      const src = fs.readFileSync(f, "utf8");
      expect(/loadPublicSpace|loadTicketByToken/.test(src), `${path.relative(SRC, f)} skips the gate`).toBe(true);
    }
  });

  it("customer text is never written with innerHTML in the browser scripts", () => {
    for (const f of ["widget-html.ts", "ticket-page.ts", "embed-script.ts"]) {
      const src = fs.readFileSync(path.join(SUPPORT_LIB, f), "utf8");
      expect(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f).toBe(false);
    }
  });

  it("nothing logs ticket text", () => {
    for (const f of publicFiles) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of Array.from(src.matchAll(/console\.(log|error|warn|info)\((.*)\);?$/gm))) {
        // only literal strings, a status code or an error object may be logged
        const args = m[2].replace(/"[^"]*"/g, "");
        expect(/message|body|question|answer|subject|email|text/i.test(args), `${path.relative(SRC, f)}: ${m[0]}`).toBe(false);
      }
    }
  });
});
