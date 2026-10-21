import { describe, it, expect } from "vitest";
import nextConfig, { APP_CSP } from "../next.config.mjs";

// Headers every page of the app carries. The public help/ticket/widget pages are excluded because they set their own.
type Rule = { source: string; headers: { key: string; value: string }[] };
const rules = (await nextConfig.headers()) as Rule[];
const appRule = rules.find((r) => r.headers.some((h) => h.key === "Content-Security-Policy"))!;
const header = (name: string) => appRule.headers.find((h) => h.key === name)?.value;
// the source is path-to-regexp text: "/(<regex>)"
const covers = (path: string) => new RegExp(`^${appRule.source.replace(/^\/\(/, "/(")}$`).test(path);

const directives = Object.fromEntries((APP_CSP as unknown as string).split("; ").map((d: string) => [d.split(" ")[0], d.split(" ").slice(1)])) as Record<string, string[]>;

describe("the app's Content-Security-Policy", () => {
  it("is on every app page, and not on the public pages that set their own", () => {
    for (const path of ["/", "/ideas", "/projects/p1/setup", "/guide", "/auth/signin", "/api/ideas", "/offline.html"]) expect(covers(path), path).toBe(true);
    for (const path of ["/widget/ihq_x", "/help/ihq_x", "/t/token", "/embed/ihq_x.js", "/api/support/ticket/x"]) expect(covers(path), path).toBe(false);
  });
  it("limits scripts to this site and Cloudflare's check, with no eval and no wildcards", () => {
    expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'", "https://ideahq.cloud", "https://challenges.cloudflare.com"]);
    expect(APP_CSP).not.toContain("unsafe-eval");
    for (const [name, values] of Object.entries(directives)) {
      if (name === "img-src") continue; // pictures may come from any https address (avatars, uploads)
      expect(values, name).not.toContain("*");
      expect(values, name).not.toContain("https:");
      expect(values, name).not.toContain("http:");
    }
  });
  it("only this site may frame the app, nothing is an object or plugin, and plain http is upgraded", () => {
    expect(directives["frame-ancestors"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(APP_CSP).toContain("upgrade-insecure-requests");
  });
  it("lets the sign-up check and the Help widget work: Cloudflare frames and requests, same-site frames", () => {
    expect(directives["frame-src"]).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(directives["connect-src"]).toEqual(["'self'", "https://challenges.cloudflare.com"]);
  });
  it("is sent with the other hardening headers", () => {
    expect(header("Content-Security-Policy")).toBe(APP_CSP);
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Strict-Transport-Security")).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
    expect(header("Permissions-Policy")).toMatch(/camera=\(\)/);
  });
  it("does not announce the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
