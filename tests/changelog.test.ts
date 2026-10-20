import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The public "What's new" page: the owner's side (switch on, write, publish) and what the
// public sees (only what was published, only while it is on).
const sess = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/db", async () => ({ db: (await import("./pg")).db }));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sess.user ? { user: sess.user } : null),
  getCurrentUserId: async () => sess.user?.id ?? null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/",
}));
process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret";

import { db, resetDb } from "./pg";
import { cleanEntryPatch, newChangelogKey, KEY_PATTERN } from "@/lib/changelog";
import { loadChangelog } from "@/lib/changelog/public-store";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/projects/[id]/changes/route";
import { POST as createEntry } from "@/app/api/projects/[id]/changes/entries/route";
import { PATCH as patchEntry, DELETE as deleteEntry } from "@/app/api/projects/[id]/changes/entries/[entryId]/route";
import ChangesPage, { generateMetadata } from "@/app/changes/[key]/page";

const req = (body?: unknown, method = "POST") => new Request("https://x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const KEY = "ihq_c_AAAAAAAAAAAAAAAA";

beforeEach(async () => {
  await resetDb();
  process.env.OWNER_EMAIL = "boss@x.se";
  sess.user = { id: "u1", email: "ann@x.se" };
  await db.user.create({ data: { id: "u1", email: "ann@x.se", approved: true } });
  await db.user.create({ data: { id: "u2", email: "bob@x.se", approved: true } });
  await db.project.create({ data: { id: "p1", userId: "u1", name: "Shop", slug: "shop", context: "SECRET CONTEXT", changelogKey: KEY, changelogOn: true } });
  await db.project.create({ data: { id: "p2", userId: "u2", name: "Theirs", slug: "theirs", context: "" } });
});

describe("keys and entry checks", () => {
  it("keys are long, unguessable and match the pattern", () => {
    const a = newChangelogKey();
    expect(a).toMatch(KEY_PATTERN);
    expect(newChangelogKey()).not.toBe(a);
  });
  it("accepts a good entry and rejects the rest with plain messages", () => {
    expect(cleanEntryPatch({ title: "  Faster search ", body: "Now 2x", kind: "improved", published: true }, { requireTitle: true })).toEqual({ ok: true, patch: { title: "Faster search", body: "Now 2x", kind: "improved", published: true } });
    for (const bad of [null, [], "x", {}, { title: " " }, { title: "x", kind: "huge" }, { title: "x", published: "yes" }, { title: "x", body: 5 }, { title: "x", extra: 1 }, { body: "y".repeat(1501) }]) {
      expect(cleanEntryPatch(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(cleanEntryPatch({ title: "x" }, { requireTitle: true })).toMatchObject({ ok: true });
    expect(cleanEntryPatch({ body: "no title" }, { requireTitle: true })).toMatchObject({ ok: false });
    expect(cleanEntryPatch({ title: "Bad‮\u0000title" })).toEqual({ ok: true, patch: { title: "Badtitle" } });
  });
});

describe("owner routes", () => {
  it("shows the page as off at first, makes a stable address when switched on, and keeps it when switched off", async () => {
    await db.project.update({ where: { id: "p1" }, data: { changelogKey: null, changelogOn: false } });
    const off = await (await getSettings(req(undefined, "GET"), { params: { id: "p1" } })).json();
    expect(off).toMatchObject({ enabled: false, url: null, entries: [] });
    const on = await (await patchSettings(req({ enabled: true }, "PATCH"), { params: { id: "p1" } })).json();
    expect(on.enabled).toBe(true);
    expect(on.url).toMatch(/\/changes\/ihq_c_[A-Za-z0-9_-]{16}$/);
    await patchSettings(req({ enabled: false }, "PATCH"), { params: { id: "p1" } });
    const again = await (await patchSettings(req({ enabled: true }, "PATCH"), { params: { id: "p1" } })).json();
    expect(again.url).toBe(on.url);
  });
  it("only the owner of the project, and only valid bodies", async () => {
    expect((await patchSettings(req({ enabled: true }, "PATCH"), { params: { id: "p2" } })).status).toBe(404);
    expect((await patchSettings(req({ enabled: "yes" }, "PATCH"), { params: { id: "p1" } })).status).toBe(400);
    expect((await patchSettings(req({ enabled: true, extra: 1 }, "PATCH"), { params: { id: "p1" } })).status).toBe(400);
    expect((await getSettings(req(undefined, "GET"), { params: { id: "p2" } })).status).toBe(404);
    sess.user = null;
    expect((await getSettings(req(undefined, "GET"), { params: { id: "p1" } })).status).toBe(401);
  });
  it("writes, edits, publishes, unpublishes and deletes entries", async () => {
    const created = await createEntry(req({ title: "Search is faster", body: "Twice as fast", kind: "improved" }), { params: { id: "p1" } });
    expect(created.status).toBe(201);
    const { entry } = await created.json();
    expect(entry.publishedAt).toBeNull();
    const pub = await (await patchEntry(req({ published: true }, "PATCH"), { params: { id: "p1", entryId: entry.id } })).json();
    expect(pub.entry.publishedAt).not.toBeNull();
    const firstTime = pub.entry.publishedAt;
    const edited = await (await patchEntry(req({ title: "Search is much faster", published: true }, "PATCH"), { params: { id: "p1", entryId: entry.id } })).json();
    expect(edited.entry).toMatchObject({ title: "Search is much faster", publishedAt: firstTime }); // re-publishing keeps the original date
    expect((await (await patchEntry(req({ published: false }, "PATCH"), { params: { id: "p1", entryId: entry.id } })).json()).entry.publishedAt).toBeNull();
    expect((await patchEntry(req({ kind: "huge" }, "PATCH"), { params: { id: "p1", entryId: entry.id } })).status).toBe(400);
    expect((await deleteEntry(req(undefined, "DELETE"), { params: { id: "p1", entryId: entry.id } })).status).toBe(200);
    expect(await db.changelogEntry.count()).toBe(0);
  });
  it("cannot touch another person's project or entries", async () => {
    const theirs = await db.changelogEntry.create({ data: { projectId: "p2", title: "Theirs" } });
    expect((await createEntry(req({ title: "x" }), { params: { id: "p2" } })).status).toBe(404);
    expect((await patchEntry(req({ published: true }, "PATCH"), { params: { id: "p2", entryId: theirs.id } })).status).toBe(404);
    const mine = await db.changelogEntry.create({ data: { projectId: "p1", title: "Mine" } });
    expect((await deleteEntry(req(undefined, "DELETE"), { params: { id: "p2", entryId: mine.id } })).status).toBe(404); // right entry, wrong project
    expect(await db.changelogEntry.count()).toBe(2);
  });
});

describe("what the public sees", () => {
  const entry = (data: Record<string, unknown>) => db.changelogEntry.create({ data: { projectId: "p1", title: "T", ...data } as never });

  it("only published entries, newest first, with nothing else from the project", async () => {
    await entry({ title: "Old", publishedAt: new Date("2026-09-01T10:00:00Z") });
    await entry({ title: "New", publishedAt: new Date("2026-10-05T10:00:00Z") });
    await entry({ title: "Draft" });
    const c = await loadChangelog(KEY);
    expect(c?.name).toBe("Shop");
    expect(c?.entries.map((e) => e.title)).toEqual(["New", "Old"]);
    expect(Object.keys(c!).sort()).toEqual(["entries", "name"]);
    expect(Object.keys(c!.entries[0]).sort()).toEqual(["body", "id", "kind", "publishedAt", "title"]);
    expect(JSON.stringify(c)).not.toContain("SECRET CONTEXT");
  });
  it("nothing while the page is off, for a wrong or malformed key, or another project's entries", async () => {
    await entry({ title: "Mine", publishedAt: new Date() });
    await db.changelogEntry.create({ data: { projectId: "p2", title: "Theirs", publishedAt: new Date() } });
    expect((await loadChangelog(KEY))?.entries.map((e) => e.title)).toEqual(["Mine"]);
    expect(await loadChangelog("ihq_c_BBBBBBBBBBBBBBBB")).toBeNull();
    expect(await loadChangelog("nope")).toBeNull();
    expect(await loadChangelog("ihq_c_AAAAAAAAAAAAAAAA' OR 1=1 --")).toBeNull();
    await db.project.update({ where: { id: "p1" }, data: { changelogOn: false } });
    expect(await loadChangelog(KEY)).toBeNull();
  });
  it("the page lists entries by month with their type and date, and escapes everything", async () => {
    await entry({ title: "<script>alert(1)</script> Fix", body: "Line one\nLine <b>two</b>", kind: "fix", publishedAt: new Date("2026-10-05T10:00:00Z") });
    await entry({ title: "Dark mode", kind: "new", publishedAt: new Date("2026-09-20T10:00:00Z") });
    const html = renderToStaticMarkup(await ChangesPage({ params: { key: KEY } }));
    expect(html).toContain("What&#x27;s new in Shop");
    expect(html).toMatch(/October 2026[^]*September 2026/);
    expect(html).toContain("Fixed");
    expect(html).toContain("New");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Fix");
    expect(html).toContain("Line &lt;b&gt;two&lt;/b&gt;");
    expect(html).toMatch(/<time dateTime="2026-10-05T10:00:00.000Z">Oct 5, 2026<\/time>/);
    expect(html).toContain("Powered by");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
  it("says so when nothing is published, and is a 404 when the page is off or the key is wrong", async () => {
    expect(renderToStaticMarkup(await ChangesPage({ params: { key: KEY } }))).toContain("Nothing has been published yet");
    await expect(ChangesPage({ params: { key: "ihq_c_BBBBBBBBBBBBBBBB" } })).rejects.toThrow("NEXT_NOT_FOUND");
    await db.project.update({ where: { id: "p1" }, data: { changelogOn: false } });
    await expect(ChangesPage({ params: { key: KEY } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("has its own title, description and canonical address; a missing page is kept out of search", async () => {
    await entry({ title: "Dark mode", publishedAt: new Date() });
    const m = await generateMetadata({ params: { key: KEY } });
    expect(m.title).toEqual({ absolute: "What's new in Shop" });
    expect(String(m.description)).toContain("Dark mode");
    expect(m.alternates?.canonical).toBe(`/changes/${KEY}`);
    const missing = await generateMetadata({ params: { key: "nope" } });
    expect(missing.robots).toMatchObject({ index: false });
  });
});
