import { describe, it, expect } from "vitest";
import { previewUrlFrom } from "@/lib/preview";
import type { PrComment } from "@/lib/github/client";

const bot = (body: string, author = "vercel[bot]"): PrComment => ({ author, bot: true, body });
const person = (body: string): PrComment => ({ author: "someone", bot: false, body });

describe("previewUrlFrom", () => {
  it("reads the Visit Preview link out of a Vercel comment, not the inspector link", () => {
    const body = "| Name | Status | Preview | Updated |\n|---|---|---|---|\n| **shop** | ✅ Ready ([Inspect](https://vercel.com/acme/shop/Abc123)) | [Visit Preview](https://shop-git-idea-hq-run1-acme.vercel.app) | Oct 20, 2026 |";
    expect(previewUrlFrom([bot(body)])).toBe("https://shop-git-idea-hq-run1-acme.vercel.app");
  });
  it("understands Netlify and Cloudflare Pages comments", () => {
    expect(previewUrlFrom([bot("Deploy Preview for shop ready!\n\n🔨 Latest commit: abc\n😎 Deploy Preview https://deploy-preview-12--shop.netlify.app", "netlify[bot]")])).toBe("https://deploy-preview-12--shop.netlify.app");
    expect(previewUrlFrom([bot("**Preview URL:** https://3f2a1b4c.shop.pages.dev\n**Branch Preview URL:** https://idea-hq-run1.shop.pages.dev", "cloudflare-workers-and-pages[bot]")])).toBe("https://3f2a1b4c.shop.pages.dev");
  });
  it("takes the newest bot comment that has a link", () => {
    expect(previewUrlFrom([bot("Preview: https://old-one.vercel.app"), bot("Preview: https://new-one.vercel.app")])).toBe("https://new-one.vercel.app");
    expect(previewUrlFrom([bot("Preview: https://old-one.vercel.app"), bot("Build failed, no preview")])).toBe("https://old-one.vercel.app");
  });
  it("ignores people, strange hosts, plain http and trick addresses", () => {
    expect(previewUrlFrom([person("Preview: https://evil.vercel.app")])).toBeNull();
    expect(previewUrlFrom([bot("Preview: https://evil.example.com/login")])).toBeNull();
    expect(previewUrlFrom([bot("Preview: http://shop.vercel.app")])).toBeNull();
    expect(previewUrlFrom([bot("Preview: https://vercel.app.evil.com")])).toBeNull();
    expect(previewUrlFrom([bot("Preview: https://user:pw@shop.vercel.app")])).toBeNull();
    expect(previewUrlFrom([bot("Preview: https://notvercel.app")])).toBeNull();
  });
  it("returns nothing for no comments or no link, and strips punctuation and paths", () => {
    expect(previewUrlFrom([])).toBeNull();
    expect(previewUrlFrom([bot("All good, nothing to preview.")])).toBeNull();
    expect(previewUrlFrom([bot("See https://shop-abc.vercel.app/some/page?x=1.")])).toBe("https://shop-abc.vercel.app");
  });
});
