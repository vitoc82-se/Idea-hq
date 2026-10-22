import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => { process.env.NEXTAUTH_SECRET = "a-test-secret-used-only-by-the-guide-test"; });
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import GuidePage from "@/app/guide/page";
import { CAPS } from "@/lib/caps-values";
import { CREDITS_PER_PACK, PRO_PRICE_LABEL } from "@/lib/billing";
import { STALE_COMMITS } from "@/lib/freshness";
import { AUTH_RULES } from "@/lib/auth-limits";
import { claude } from "@/lib/providers";
import { openai } from "@/lib/providers";
import { STUCK_AFTER_MS } from "@/lib/runs/engine";
import { TIERS } from "@/lib/runs/policy";

// The Guide is the answer to "what do I do now?", so what it says has to be what the app says. These tests pin the
// names it uses for buttons and the numbers it quotes to the app's own source, so they cannot drift apart quietly.
const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "generated") walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const guideFile = path.join(ROOT, "src/app/guide/page.tsx");
const corpus = walk(path.join(ROOT, "src")).filter((f) => f !== guideFile).map((f) => fs.readFileSync(f, "utf8")).join("\n")
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"');
const render = async () => renderToStaticMarkup(await GuidePage());
const text = async () => (await render()).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("the Guide names things the way the app does", () => {
  // Every button, menu item and screen name the Guide tells people to look for.
  const LABELS = [
    "Set up this project", "Project knowledge", "Connect GitHub", "Read my repo and describe it", "This looks right",
    "Quick draft from my repo", "Learn deeply in my GitHub", "Answer a few questions", "This is right", "Looks right, confirm all", "Save a copy in my repo",
    "Update the workflow", "Update workflow", "Generate build prompt", "Implement", "Implement again", "Approve and run", "Approve and merge", "Request changes", "Revert this change", "Cancel run",
    "Break into stories", "Estimate them all", "See it running", "No preview link yet", "Build and tests passed", "What the AI said",
    "Most reported", "Quick wins first", "Value / effort", "Quick wins", "Big bets", "Fill-ins", "Time sinks", "Ideas and bugs", "Blocked by",
    "Import ideas", "Monthly cap", "Focus", "Billing", "Upgrade", "Settings", "Your data", "Download my data", "Delete my account", "Sign out on all devices",
    "Turn on support", "Draft notes from my project knowledge", "Add it for me", "Check my site", "Track this", "Turn into a bug", "Add to an existing one", "Write an entry by hand",
    "Show a public What's new page", "Confirm my email", "Send the email again", "Waiting for approval", "Starting", "AI is working", "PR ready for review",
    "Confirmed with GitHub", "The AI works on the change", "Plan it", "Build it", "Adjust model and turns", "Ask for changes", "Details and overrides", "Priority", "Value", "Size", "Ask the AI to fix it", "Split it into steps", "Merge", "Closing note", "Describe", "Ship",
  ];
  it("every label it quotes is on a screen of the app", async () => {
    const html = await text();
    for (const l of LABELS) {
      expect(html.includes(l) || html.toLowerCase().includes(l.toLowerCase()), `the Guide no longer mentions "${l}": update this list`).toBe(true);
    }
    // "Waiting for approval" is a page title, "Upgrade"/"Billing" menu items, and so on: all must exist in the source.
    const missing = LABELS.filter((l) => !corpus.includes(l) && !corpus.toLowerCase().includes(l.toLowerCase()));
    expect(missing, `quoted in the Guide but not found in the app: ${missing.join(" | ")}`).toEqual([]);
  });
  it("does not use names that no longer exist", async () => {
    const html = await text();
    for (const old of ["Knows 60%", "Set the checks", "(version 5)", "Anthropic account and an API key"]) expect(html).not.toContain(old);
  });
});

describe("the numbers in the Guide are the app's numbers", () => {
  it("size limits", async () => {
    const html = await text();
    expect(html).toContain(`titles up to ${CAPS.title} characters`);
    expect(html).toContain(`notes up to ${CAPS.notes.toLocaleString("en-US")}`);
    expect(html).toContain(`a project description up to ${CAPS.projectContext.toLocaleString("en-US")}`);
    expect(html).toContain(`${CAPS.projectsPerUser} projects per account`);
    expect(html).toContain(`${CAPS.ideasPerProject.toLocaleString("en-US")} ideas per project`);
  });
  it("the rescan prompt, the plan prices and the sign-in waits", async () => {
    const html = await text();
    expect(html).toContain(`${STALE_COMMITS} or more commits`);
    expect(html).toContain(`Pro, ${PRO_PRICE_LABEL.replace(" / ", " a ")}`);
    expect(html).toContain(`${CREDITS_PER_PACK} AI runs`);
    expect(AUTH_RULES.loginPair("a", "b").windowSec).toBe(15 * 60); // "wait about 15 minutes"
    expect(AUTH_RULES.registerIp("a").windowSec).toBe(60 * 60); // "or an hour for signing up"
    expect(html).toContain("about 15 minutes");
    expect(html).toContain("an hour for signing up");
  });
  it("the stuck-run timeout and the API key names", async () => {
    const html = await text();
    expect(STUCK_AFTER_MS).toBe(45 * 60 * 1000);
    expect(html).toContain("45 minutes");
    expect(html).toContain(claude.secretName);
    expect(html).toContain(openai.secretName);
  });
  it("the turn limits leave room for a real change, and the Guide does not quote old numbers", async () => {
    for (const t of TIERS) expect(t.maxTurns).toBeGreaterThanOrEqual(30);
    const html = await text();
    expect(html).not.toMatch(/(?:up to|limit of|all) 15 turns/); // the old Quick ceiling; "5 to 15 turns" is a typical range
  });
});

describe("the Guide has the new look", () => {
  it("is inside the notebook skin on graph paper, with the hand-drawn step rings and the pen underline", async () => {
    const html = await render();
    expect(html).toContain("nb-skin");
    expect(html).toContain("nb-grid");
    expect(html).toContain("light:block");
    expect(html).toContain("read me first");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*viewBox="0 0 64 64"/); // a step ring
  });
  it("has a section for each contents entry, and the new ones are there", async () => {
    const html = await render();
    const ids = Array.from(html.matchAll(/href="#([a-z]+)"/g)).map((m) => m[1]);
    for (const id of ids) expect(html, id).toContain(`id="${id}"`);
    for (const id of ["board", "stuck", "cost", "safe"]) expect(ids).toContain(id);
  });
});
