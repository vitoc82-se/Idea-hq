import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Email when a change is ready or a run fails: who gets it, what it says, and that a
// broken email service never breaks anything.
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { notifyRunEvent, runEmail } from "@/lib/notify";

type Sent = { to: string[]; subject: string; text: string; from: string };
let sent: Sent[];
const okFetch = (async (_url: string, init: RequestInit) => {
  const b = JSON.parse(String(init.body));
  sent.push({ to: b.to, subject: b.subject, text: b.text, from: b.from });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;

async function seed(user: Record<string, unknown> = {}, run: Record<string, unknown> = {}) {
  await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true, ...user } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "" } });
  await db.idea.create({ data: { id: "i1", userId: "u1", projectId: "p1", title: "Add a search box" } });
  await db.run.create({ data: { id: "r1", userId: "u1", projectId: "p1", ideaId: "i1", status: "pr_open", ...run } });
}

beforeEach(async () => {
  await resetDb();
  sent = [];
  process.env.RESEND_API_KEY = "re_test";
  process.env.SUPPORT_FROM_EMAIL = "support@ideahq.cloud";
  process.env.SUPPORT_BASE_URL = "https://ideahq.cloud";
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SUPPORT_FROM_EMAIL;
  delete process.env.SUPPORT_BASE_URL;
});

describe("notifyRunEvent", () => {
  it("tells the owner a change is ready, with a link to the idea and how to turn it off", async () => {
    await seed();
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: okFetch })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["ann@x.se"]);
    expect(sent[0].subject).toBe("Ready for review: Add a search box (Shop)");
    expect(sent[0].text).toContain("https://ideahq.cloud/ideas/i1");
    expect(sent[0].text).toContain("https://ideahq.cloud/settings");
    expect(sent[0].from).toContain("Idea HQ");
  });
  it("says it is ready again after a revision, and why a run failed", async () => {
    await seed({}, { status: "failed", error: "The AI made no changes." });
    await notifyRunEvent("r1", "updated", { fetchImpl: okFetch });
    await notifyRunEvent("r1", "failed", { fetchImpl: okFetch });
    expect(sent[0].subject).toMatch(/^Updated and ready again: Add a search box/);
    expect(sent[1].subject).toMatch(/^Did not finish: Add a search box/);
    expect(sent[1].text).toContain("The AI made no changes.");
    expect(sent[1].text).toMatch(/Nothing was changed in your project/);
  });
  it("sends nothing when the person turned notifications off", async () => {
    await seed({ notifyEmail: false });
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: okFetch })).toBe(false);
    expect(sent).toHaveLength(0);
  });
  it("sends nothing without an address, without email set up, or for a missing run, and never throws", async () => {
    await seed({ email: null });
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: okFetch })).toBe(false);
    expect(await notifyRunEvent("nope", "ready", { fetchImpl: okFetch })).toBe(false);
    await db.user.update({ where: { id: "u1" }, data: { email: "ann@x.se" } });
    delete process.env.RESEND_API_KEY;
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: okFetch })).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    const boom = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: boom })).toBe(false);
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await notifyRunEvent("r1", "ready", { fetchImpl: bad })).toBe(false);
    quiet.mockRestore();
  });
  it("keeps a header-breaking idea title out of the subject line", () => {
    const m = runEmail({ event: "ready", kind: "implement", title: "Hello\r\nBcc: evil@x.se", project: "Shop", error: null, link: "https://x", settingsLink: "https://y" });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
  it("links project knowledge runs to the knowledge page", async () => {
    await seed({}, { kind: "learn", ideaId: null });
    await notifyRunEvent("r1", "ready", { fetchImpl: okFetch });
    expect(sent[0].text).toContain("https://ideahq.cloud/projects/p1/knowledge");
    expect(sent[0].subject).toMatch(/^Ready for review: Project knowledge/);
  });
});
