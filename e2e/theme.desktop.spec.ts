import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdeas } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

test("the Light and Dark switch changes the page and is remembered", async ({ page }) => {
  await openIdeas(page);
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // set before the first paint, no flash of the other theme
  await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");
});

test("the app's screens load in both themes without an error", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((t) => { try { localStorage.setItem("ideahq-theme", t); } catch { /* private window */ } }, theme);
    for (const url of ["/ideas", "/ideas/ready", "/focus", "/projects", "/guide"]) {
      await page.goto(url);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("main, [role=main], h1").first()).toBeVisible();
    }
  }
});

test("the public pages, signed out, load in both themes without an error", async ({ browser }) => {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    failOnPageErrors(page);
    await page.addInitScript((t) => { try { localStorage.setItem("ideahq-theme", t); } catch { /* private window */ } }, theme);
    for (const url of ["/", "/guide", "/auth/signin"]) {
      await page.goto(url);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("h1").first()).toBeVisible();
    }
    await context.close();
  }
});
