import { describe, it, expect, vi, beforeEach } from "vitest";

// A customer's email address or phone number, typed into a support ticket, must not travel into the Actions
// logs and pull requests of a PUBLIC repository when the ticket becomes a bug or idea.
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "u1", email: "ann@x.se" } }), getCurrentUserId: async () => "u1" }));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { redactPersonalDetails, repoMayBePublic, PUBLIC_REPO_NOTICE } from "@/lib/runs/public-safe";
import { draftFromTicket, createIssueFromTicket } from "@/lib/issues";

describe("redactPersonalDetails", () => {
  it("removes email addresses and phone numbers, in common forms", () => {
    expect(redactPersonalDetails("write to jane.doe+shop@example.co.uk please")).toBe("write to [email removed] please");
    for (const phone of ["070-123 45 67", "+46 70 123 45 67", "(555) 123-4567", "0701234567", "+1 555.123.4567"]) {
      expect(redactPersonalDetails(`call ${phone} now`), phone).toBe("call [number removed] now");
    }
  });
  it("leaves ordinary text, versions, dates, short numbers and ids alone", () => {
    for (const ok of ["Order A-100 failed on v2.14.3", "On 2026-10-20 it broke", "Error 500 at step 3", "ticket #12345", "the build took 1234567 ms (too long)", "a@b is not an address"]) {
      expect(redactPersonalDetails(ok), ok).toBe(ok);
    }
  });
  it("treats a repo as possibly public unless GitHub said it is private", () => {
    expect(repoMayBePublic({ repoPrivate: true })).toBe(false);
    expect(repoMayBePublic({ repoPrivate: false })).toBe(true);
    expect(repoMayBePublic({ repoPrivate: null })).toBe(true);
    expect(repoMayBePublic({})).toBe(true);
    expect(PUBLIC_REPO_NOTICE).toMatch(/public/);
  });
});

describe("ticket to bug", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.OWNER_EMAIL = "ann@x.se";
    await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
    for (const [id, priv] of [["pub", false], ["priv", true], ["unknown", null]] as const) {
      await db.project.create({ data: { id, userId: "u1", name: id, slug: id, context: "", repoPrivate: priv } });
      await db.ticket.create({ data: { id: `t-${id}`, projectId: id, number: 1, subject: "Login broken for jane@example.com", customerEmail: "jane@example.com", tokenHash: `h-${id}`, fields: [{ id: "f", label: "Phone", value: "070-123 45 67" }] } });
      await db.ticketMessage.create({ data: { ticketId: `t-${id}`, author: "customer", body: "I cannot log in. Reach me at jane@example.com or +46 70 123 45 67." } });
    }
  });

  it("a public repo: the draft has the details removed, says so, and tells the owner the repo is public", async () => {
    const d = await draftFromTicket("u1", "t-pub");
    expect(d.title).toBe("Login broken for [email removed]");
    expect(d.notes).not.toMatch(/jane@example\.com|070-123|\+46 70/);
    expect(d.notes).toContain("[email removed]");
    expect(d.notes).toContain("[number removed]");
    expect(d.repoPublic).toBe(true);
    expect(d.personalDetailsRemoved).toBe(true);
  });
  it("a repo that is not known yet: details removed too, but no 'public' warning is claimed", async () => {
    const d = await draftFromTicket("u1", "t-unknown");
    expect(d.notes).not.toMatch(/jane@example\.com/);
    expect(d.repoPublic).toBe(false);
  });
  it("a private repo: nothing is changed", async () => {
    const d = await draftFromTicket("u1", "t-priv");
    expect(d.notes).toContain("jane@example.com");
    expect(d.repoPublic).toBe(false);
    expect(d.personalDetailsRemoved).toBe(false);
  });
  it("whatever the owner sends when creating it is cleaned again for a public repo", async () => {
    const idea = await createIssueFromTicket("u1", "t-pub", { kind: "bug", title: "Fix for jane@example.com", notes: "Reach jane@example.com", repro: "Call 070-123 45 67" });
    const row = (await db.idea.findUnique({ where: { id: idea.id } }))!;
    expect(`${row.title} ${row.notes} ${row.repro}`).not.toMatch(/jane@example\.com|070-123/);
    const priv = await createIssueFromTicket("u1", "t-priv", { kind: "bug", title: "Fix for jane@example.com", notes: "Reach jane@example.com" });
    expect((await db.idea.findUnique({ where: { id: priv.id } }))!.notes).toContain("jane@example.com");
  });
});
