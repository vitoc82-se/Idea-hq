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

// The public pages as a visitor sees them. (Signed in, the Guide sometimes hydrates twice under heavy load: see TODOS.md.)
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the Guide and the start page fit a phone", async ({ page }) => {
    for (const url of ["/guide", "/"]) {
      await page.goto(url);
      expect(await noSideScroll(page), url).toBe(true);
    }
  });
});
