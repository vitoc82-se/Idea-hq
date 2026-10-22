import { test, expect } from "@playwright/test";
import { failOnPageErrors } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

test("signed in, the Guide offers the way back into the app; the buttons for a visitor never show", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to my ideas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
});

test("signed out, it offers sign-in and sign-up", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  failOnPageErrors(page);
  await page.goto("/guide");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the app" })).toHaveCount(0);
  await context.close();
});

// The Guide is one static file for everyone. When it waited on the session on the server it sometimes hydrated twice
// for a signed-in person under load ("Hydration failed", and the theme attribute on <html> was lost).
test("the Guide is a static page, not drawn per visitor", async ({ request }) => {
  const res = await request.get("/guide");
  expect(res.headers()["x-nextjs-prerender"]).toMatch(/^1/); // Next sends it twice: "1, 1"
});

test("loading it signed in, many at once, never hydrates twice", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 6 }, () => browser.newContext({ storageState: "e2e/.auth/dev.json" })));
  const errors: string[] = [];
  const themes: (string | null)[] = [];
  for (let round = 0; round < 3; round++) {
    await Promise.all(contexts.map(async (context) => {
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 80)));
      await page.goto(`${baseURL}/guide`);
      await page.waitForTimeout(250);
      themes.push(await page.locator("html").getAttribute("data-theme"));
      await page.close();
    }));
  }
  await Promise.all(contexts.map((c) => c.close()));
  expect(errors).toEqual([]);
  expect(themes.every((t) => t === "light" || t === "dark")).toBe(true); // the theme attribute was the thing lost
});
