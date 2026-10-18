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
  it("explains what Idea HQ does to a signed-out visitor, with a way in", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain("Turn your ideas into working changes");
    expect(html).toMatch(/How it works/);
    expect(html).toContain("/auth/signin?mode=register");
    expect(html).toContain('href="/guide"');
    expect(html).toMatch(/approved by the owner/);
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
    for (const label of ["Generate build prompt", "Approve and run", "Approve and merge", "Draft it from my repo", "Request changes", "Revert this change", "Break into stories", "Check again"]) {
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
