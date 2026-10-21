import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { logError } from "@/lib/log";

// A failing database call can carry what was being saved. The log must never.
afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  const lines = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" "));
  it("writes the label, the kind of error and its code, and nothing else", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const prisma = Object.assign(new Error('Unique constraint failed on the fields: (`email`) with value "ann@example.com" in {"title":"my secret idea"}'), {
      name: "PrismaClientKnownRequestError", code: "P2002", meta: { target: ["email"] }, stack: "at secret/path/file.ts:1",
    });
    logError("Create idea error:", prisma);
    expect(lines()).toEqual(["Create idea error: PrismaClientKnownRequestError code=P2002"]);
    const all = lines().join("\n");
    expect(all).not.toMatch(/ann@example|secret idea|Unique constraint|secret\/path|meta/);
  });
  it("includes a status when there is one, and a little context", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("webhook error", Object.assign(new Error("Bearer ghs_SECRET"), { name: "GitHubError", status: 502 }), "pull_request", "delivery-1");
    expect(lines()).toEqual(["webhook error pull_request delivery-1 GitHubError status=502"]);
  });
  it("copes with anything being thrown", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("a", "a string with ann@example.com");
    logError("b", null);
    logError("c", undefined);
    logError("d", { weird: true });
    logError("e", 42);
    const all = lines().join("\n");
    expect(all).not.toContain("ann@example.com");
    expect(lines()).toEqual(["a string", "b object", "c", "d object", "e number"]);
  });
  it("limits how much of a label or context goes in", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("x", new Error("m"), "y".repeat(500));
    expect(lines()[0].length).toBeLessThan(200);
  });
});

describe("no code logs a raw error", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) { if (!full.includes("generated")) walk(full); } else if (/\.(ts|tsx)$/.test(f)) files.push(full);
    }
  };
  walk("src");
  it("every console.error prints only fixed text, a name, a code or a status", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === "src/lib/log.ts") continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!/console\.error\(/.test(line)) return;
        const args = line.slice(line.indexOf("console.error(") + 14);
        // allowed: string literals, and the few safe expressions below; anything else could be an error object
        const safe = /^\s*"[^"]*"\s*(,\s*(\(\w+ as Error\)\??\.name|code|res\.status|error\.status \?\? "none"|\w+\.status))?\s*\);?/.test(args);
        if (!safe) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("and nothing logs with console.log or console.warn", () => {
    const bad = files.filter((f) => /console\.(log|warn|info|debug)\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
