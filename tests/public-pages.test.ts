import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const sess = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("next-auth", () => ({ getServerSession: async () => (sess.user ? { user: sess.user } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }));
vi.mock("next/navigation", () => ({ redirect }));

import HomePage from "@/app/page";
import GuidePage from "@/app/guide/page";

beforeEach(() => { sess.user = null; redirect.mockClear(); });

describe("start page", () => {
  it("puts Create account front and centre, with only small print below", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain("Idea HQ");
    expect(html).toMatch(/An AI builds them into your project/);
    // the big primary button is the sign-up link
    expect(html).toMatch(/<a[^>]*href="\/auth\/signin\?mode=register"[^>]*>Create account<\/a>/);
    expect(html).toContain('href="/auth/signin"');
    expect(html).toMatch(/approved by the owner/);
    expect(html).toContain('href="/guide"');
  });

  it("stays short: no marketing sections yet", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).not.toMatch(/How it works<\/h2>|What you need|You stay in control/);
    expect(html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length).toBeLessThan(80);
  });

  it("sends a signed-in user straight to their ideas", async () => {
    sess.user = { id: "u1" };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/ideas");
  });
});

describe("guide page", () => {
  it("is public and has every section the contents list links to", async () => {
    const html = renderToStaticMarkup(await GuidePage());
    const anchors = Array.from(html.matchAll(/href="#([a-z]+)"/g)).map((m) => m[1]);
    expect(anchors.length).toBeGreaterThanOrEqual(10);
    for (const id of anchors) expect(html, `missing section #${id}`).toContain(`id="${id}"`);
  });

  it("covers the questions a newcomer has: words, setup, cost, safety, getting unstuck", async () => {
    const html = renderToStaticMarkup(await GuidePage());
    for (const needle of ["Pull request", "API key", "ANTHROPIC_API_KEY", "What it costs", "Staying in control", "If you get stuck", "Waiting for approval", "Update workflow"]) {
      expect(html, needle).toContain(needle);
    }
  });

  it("uses the same button names as the app, so people can follow along", async () => {
    const html = renderToStaticMarkup(await GuidePage());
    for (const label of ["Generate build prompt", "Approve and run", "Approve and merge", "Request changes", "Revert this change", "Break into stories", "Check again", "Quick draft from my repo", "Learn deeply in my GitHub", "Answer a few questions", "Save a copy in my repo", "Read my repo and describe it", "This looks right", "Turn on support", "Add it for me", "Import ideas", "Draft notes from my project knowledge", "Check my site"]) {
      expect(html, label).toContain(label);
    }
  });

  it("offers a way back into the app when signed in, and sign-up when not", async () => {
    expect(renderToStaticMarkup(await GuidePage())).toContain("/auth/signin?mode=register");
    sess.user = { id: "u1" };
    const html = renderToStaticMarkup(await GuidePage());
    expect(html).toContain("Back to my ideas");
    expect(html).not.toContain("Create an account");
  });
});
