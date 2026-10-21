import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The small findings from the security review (L1 to L5).
const path = vi.hoisted(() => ({ current: "/ideas" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("next/script", () => ({ default: (p: { src: string }) => createElement("script", { src: p.src }) }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { authOptions } from "@/lib/auth";
import { APP_VERSION, formatVersion } from "@/lib/version";
import { ownerDisplayName } from "@/lib/owner";
import { HelpWidget } from "@/components/help-widget";
import { encodeRepoPath } from "@/lib/github/client";

const files: string[] = [];
const walk = (dir: string) => { for (const f of readdirSync(dir)) { const full = join(dir, f); if (statSync(full).isDirectory()) { if (!full.includes("generated")) walk(full); } else if (/\.(ts|tsx)$/.test(f)) files.push(full); } };
walk("src");

describe("L1: sign-in with Google is not weakened", () => {
  it("never links an account by email address alone, and keeps the default state and PKCE checks", () => {
    for (const p of authOptions.providers as unknown as { id: string; options?: Record<string, unknown> }[]) {
      expect(p.options?.allowDangerousEmailAccountLinking, p.id).toBeUndefined();
      expect(p.options?.checks, p.id).toBeUndefined(); // the defaults (state + PKCE) stay in force
    }
    expect(JSON.stringify(Object.keys(authOptions))).not.toMatch(/useSecureCookies|debug/);
    expect(authOptions.session?.strategy).toBe("jwt");
    expect(files.filter((f) => /allowDangerousEmailAccountLinking|checks:\s*\[\s*\]/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("L2: the commit id is not in the page code", () => {
  it("the menu shows the version only, even when the build id is known", () => {
    expect(APP_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(formatVersion("1.2.3", "abcdef1234")).toBe("v1.2.3 · abcdef1"); // still available for the owner's Admin page
    expect(files.filter((f) => /NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA/.test(readFileSync(f, "utf8")))).toEqual([]);
    expect(readFileSync("next.config.mjs", "utf8")).not.toMatch(/COMMIT_SHA/);
  });
});

describe("L3: nothing in the app is hard-wired to one person or one instance", () => {
  beforeEach(async () => { await resetDb(); process.env.OWNER_EMAIL = "boss@x.se"; });
  it("names the owner from the owner's own account", async () => {
    await db.user.create({ data: { id: "o", email: "boss@x.se", name: "Ann Lindqvist", approved: true } });
    expect(await ownerDisplayName()).toBe("Ann");
    await db.user.update({ where: { id: "o" }, data: { name: "  " } });
    expect(await ownerDisplayName()).toBe("the owner");
    await db.user.update({ where: { id: "o" }, data: { name: "X".repeat(100) } });
    expect((await ownerDisplayName()).length).toBe(40);
  });
  it("says 'the owner' when there is no owner account yet", async () => {
    expect(await ownerDisplayName()).toBe("the owner");
  });
  it("no source file mentions a person by name", () => {
    expect(files.filter((f) => /\bNiklas\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  describe("the Help button", () => {
    const saved = process.env.NEXT_PUBLIC_HELP_WIDGET_KEY;
    afterEach(() => { if (saved === undefined) delete process.env.NEXT_PUBLIC_HELP_WIDGET_KEY; else process.env.NEXT_PUBLIC_HELP_WIDGET_KEY = saved; path.current = "/ideas"; });
    const html = () => renderToStaticMarkup(createElement(HelpWidget));
    it("loads this site's own script from this site, with a key that can be set", () => {
      delete process.env.NEXT_PUBLIC_HELP_WIDGET_KEY;
      expect(html()).toBe('<script src="/embed/ihq_-_xUVVCWx3RoG-QU.js"></script>');
      process.env.NEXT_PUBLIC_HELP_WIDGET_KEY = "ihq_other_key";
      expect(html()).toBe('<script src="/embed/ihq_other_key.js"></script>');
    });
    it("shows no Help button when the key is empty, and never on a project's public pages", () => {
      process.env.NEXT_PUBLIC_HELP_WIDGET_KEY = "";
      expect(html()).toBe("");
      delete process.env.NEXT_PUBLIC_HELP_WIDGET_KEY;
      path.current = "/changes/ihq_c_AAAA";
      expect(html()).toBe("");
    });
  });
});

describe("L4: file paths in GitHub addresses", () => {
  it("each part is encoded, so the path cannot change the address", () => {
    expect(encodeRepoPath("src/app/page.tsx")).toBe("src/app/page.tsx");
    expect(encodeRepoPath("docs/My File #1?.md")).toBe("docs/My%20File%20%231%3F.md");
    expect(encodeRepoPath("a/b%2Fc")).toBe("a/b%252Fc");
    expect(encodeRepoPath("/leading/slash")).toBe("leading/slash");
    expect(encodeRepoPath("ünï/💥.txt")).toBe("%C3%BCn%C3%AF/%F0%9F%92%A5.txt");
  });
  it("parts that climb or are empty are refused", () => {
    for (const bad of ["..", "../x", "a/../b", "a/./b", "a//b", "a/", "", "./x", "a/.."]) expect(() => encodeRepoPath(bad), bad).toThrow(/valid file path/);
  });
  describe("in the real requests", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });
    it("the address GitHub receives has the encoded path, and a climbing path makes no request at all", async () => {
      const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.GITHUB_APP_ID = "1";
      process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const urls: string[] = [];
      globalThis.fetch = (async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes("/access_tokens")) return new Response(JSON.stringify({ token: "T", expires_at: new Date(Date.now() + 3_600_000).toISOString() }), { status: 201 });
        return new Response(JSON.stringify({ sha: "s", content: Buffer.from("hi").toString("base64") }));
      }) as unknown as typeof fetch;
      const real = await vi.importActual<typeof import("@/lib/github/client")>("@/lib/github/client");
      await real.github.getFile(901, "o", "r", "docs/My File #1?.md", "feature/x y");
      expect(urls.at(-1)).toBe("https://api.github.com/repos/o/r/contents/docs/My%20File%20%231%3F.md?ref=feature%2Fx%20y");
      const before = urls.length;
      await expect(real.github.getFile(901, "o", "r", "../../other/repo/secret", "main")).rejects.toThrow(/valid file path/);
      await expect(real.github.putFile(901, "o", "r", "a/../../b", "main", "x", "m")).rejects.toThrow(/valid file path/);
      expect(urls.length).toBe(before);
      await real.github.listDir(901, "o", "r", "", "main"); // the repository root still works
      expect(urls.at(-1)).toBe("https://api.github.com/repos/o/r/contents/?ref=main");
    });
  });
});
