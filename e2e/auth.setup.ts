import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE } from "../playwright.config";
import { DEV_USER } from "../src/lib/dev-seed";

// Sign in once through the real form and keep the session for the signed-in tests.
setup("sign in as the sample owner", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.getByLabel("Email").fill(DEV_USER.email);
  await page.getByLabel("Password").fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/ideas/);
  await page.context().storageState({ path: AUTH_FILE });
});
