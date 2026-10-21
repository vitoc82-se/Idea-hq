import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const sess = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("next-auth", () => ({ getServerSession: async () => (sess.user ? { user: sess.user } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); }));
vi.mock("next/navigation", () => ({ redirect }));
// next/font only works inside the Next compiler; here the three fonts are just class names.
vi.mock("@/components/landing/fonts", () => ({
  notebookSans: { variable: "nb-sans" },
  notebookPen: { variable: "nb-pen" },
  notebookMono: { variable: "nb-mono" },
}));

import HomePage from "@/app/page";
import GuidePage from "@/app/guide/page";

beforeEach(() => { sess.user = null; redirect.mockClear(); });

describe("start page", () => {
  it("says what the product does and puts early access and Sign in up front", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain("Idea HQ");
    expect(html).toMatch(/Keep shipping your app\./);
    expect(html).toMatch(/Skip the code editor\./);
    expect(html).toMatch(/nothing changes until you approve it/);
    expect(html).toMatch(/<a[^>]*href="\/auth\/signin\?mode=register"[^>]*>Request early access<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/auth\/signin"[^>]*>Sign in<\/a>/);
    expect(html).toMatch(/<a[^>]*href="#demo"[^>]*>Watch the 90-second demo<\/a>/);
    expect(html).toContain('href="/guide"');
  });

  it("has every section the menu links to", async () => {
    const html = renderToStaticMarkup(await HomePage());
    for (const id of ["how", "receipts", "safety", "pricing", "demo", "top"]) {
      expect(html, `#${id} link`).toContain(`href="#${id}"`);
      expect(html, `section #${id}`).toContain(`id="${id}"`);
    }
  });

  it("carries the first idea to sign-up in the address, with no script needed", async () => {
    const html = renderToStaticMarkup(await HomePage());
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toContain('action="/auth/signin"');
    expect(form).toContain('method="get"');
    expect(form).toMatch(/<input[^>]*type="hidden"[^>]*name="mode"[^>]*value="register"/);
    expect(form).toMatch(/<label[^>]*for="first-idea"/);
    expect(form).toMatch(/<input[^>]*id="first-idea"[^>]*name="idea"/);
  });

  it("shows the four real receipts and the price list", async () => {
    const html = renderToStaticMarkup(await HomePage());
    for (const cost of ["$0.01", "$0.17", "$0.21", "$0.74"]) expect(html, cost).toContain(cost);
    expect(html).toContain("IDEA HQ · PRICE LIST");
    expect(html).toContain("€9 / month");
    expect(html).toContain("€5 once");
  });

  it("keeps the pretend Tweak and Merge buttons out of the keyboard and screen readers", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html).not.toMatch(/<button[^>]*>(Tweak|Merge)/);
    expect(html.match(/<button/g)).toHaveLength(1); // only the real submit button at the bottom
    const hero = html.slice(html.indexOf('role="img"'), html.indexOf('id="demo"'));
    expect(hero).toContain('aria-hidden="true"');
    expect(hero).toContain("Tweak");
  });

  it("has one h1, one main landmark, a labelled input, no skipped heading level, and no empty promises", async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toMatch(/Prove the bug\. Then fix it\.<\/h2>/);
    expect(html).not.toMatch(/<h4/);
    expect(html).not.toMatch(/free forever|instant|guarantee|10x|revolutioni/i);
  });

  it("sets the page colour for phones to the landing page's own ink", async () => {
    const page = await import("@/app/page");
    expect(page.viewport.themeColor).toBe("#15161A");
    expect(page.metadata.title).toEqual({ absolute: "Idea HQ: keep shipping your app" });
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
