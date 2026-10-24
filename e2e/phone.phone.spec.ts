import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdea, openIdeas, row } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

const noSideScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the Ideas list fits a phone, and the next step is at least 44px to tap", async ({ page }) => {
  await openIdeas(page);
  expect(await noSideScroll(page)).toBe(true);
  const merge = row(page, "Search box").getByRole("link", { name: /Merge/ });
  const box = await merge.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("an idea page fits a phone in every stage", async ({ page }) => {
  for (const id of ["n1", "ready", "busy", "green", "red", "done", "rv", "big"]) {
    await openIdea(page, id);
    expect(await noSideScroll(page), id).toBe(true);
  }
});

test("the knowledge page and the projects page fit a phone, with a suggestion waiting", async ({ page }) => {
  for (const url of ["/projects/p1/knowledge", "/projects"]) {
    await page.goto(url);
    await expect(page.locator("main, h1").first()).toBeVisible();
    expect(await noSideScroll(page), url).toBe(true);
  }
});

test("the Guide fits a phone, signed in and signed out, and so does the start page", async ({ page, browser }) => {
  await page.goto("/guide");
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible(); // the browser's session has loaded
  expect(await noSideScroll(page), "/guide signed in").toBe(true);
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: page.viewportSize() ?? undefined, isMobile: true, hasTouch: true });
  const guest = await visitor.newPage();
  for (const url of ["/guide", "/"]) {
    await guest.goto(url);
    expect(await noSideScroll(guest), `${url} signed out`).toBe(true);
  }
  await visitor.close();
});
