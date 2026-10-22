import { test, expect } from "@playwright/test";
import { failOnPageErrors } from "./helpers";
import { DEV_USER } from "../src/lib/dev-seed";

test.beforeEach(({ page }) => failOnPageErrors(page));

test("the start page says what the product does and links to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep shipping your app");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Request early access" }).first()).toBeVisible();
});

test("the Guide is public and its contents link to real sections", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const anchors = await page.locator('a[href^="#"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.slice(1)).filter(Boolean));
  expect(anchors.length).toBeGreaterThan(8);
  for (const id of anchors) await expect(page.locator(`[id="${id}"]`), `section #${id}`).toHaveCount(1);
});

test("the app asks you to sign in first", async ({ page }) => {
  await page.goto("/ideas");
  await expect(page).toHaveURL(/\/auth\/signin/);
});

test("a wrong password is refused with a plain message, the right one gets in", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.getByLabel("Email").fill(DEV_USER.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await page.getByLabel("Password").fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/ideas/);
});
