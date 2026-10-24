import { test, expect } from "@playwright/test";
import { failOnPageErrors } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

// The tests that save something each use their own idea (by repeat number), so running them again on the same server,
// or at the same time, never trips over what an earlier run saved.
const OWN = ["ready", "red", "green", "busy", "rev"];
const own = () => OWN[test.info().repeatEachIndex % OWN.length];

// The sample idea "Hand-edited idea" already has a scope and a build prompt the owner changed, and a correction.
async function openDetails(page: import("@playwright/test").Page, id: string) {
  await page.goto(`/ideas/${id}`);
  await expect(page.locator("#journey")).toBeVisible();
  const toggle = page.getByRole("button", { name: /Details and overrides/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

test("the owner's own scope and build prompt are marked, and the correction is shown in both places", async ({ page }) => {
  await openDetails(page, "handmade");
  await expect(page.getByTestId("scope-edited")).toHaveText("Written by you");
  await expect(page.getByTestId("scope-text")).toHaveText("Fold it into the existing job.");
  await expect(page.getByTestId("plan-edited")).toHaveText("Changed by you");
  await expect(page.getByTestId("plan-text")).toContainText("# Build it my way");
  await expect(page.getByRole("button", { name: "Re-size", exact: true })).toBeVisible(); // keeps the owner's scope
  await expect(page.getByRole("button", { name: "Write a new scope" })).toBeVisible();
  await expect(page.locator("#corrections-scope")).toHaveValue("The settings screen already exists.");
  await expect(page.locator("#corrections-plan")).toHaveValue("The settings screen already exists.");
});

test("a scope the AI wrote has no mark", async ({ page }) => {
  await openDetails(page, "wait"); // nothing ever saves a change to this one
  await expect(page.getByTestId("scope-text")).toBeVisible();
  await expect(page.getByTestId("scope-edited")).toHaveCount(0);
  await expect(page.getByTestId("plan-edited")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Re-estimate", exact: true })).toBeVisible();
});

test("a scope can be edited and saved, and stays", async ({ page }) => {
  await openDetails(page, own());
  const mine = `Fold it into the retention job (${Date.now()}).`;
  await page.getByRole("button", { name: "Edit the scope" }).click();
  await page.getByRole("textbox", { name: "Implementation scope" }).fill(mine);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("scope-text")).toHaveText(mine);
  await expect(page.getByTestId("scope-edited")).toBeVisible();
  await page.reload();
  const toggle = page.getByRole("button", { name: /Details and overrides/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByTestId("scope-text")).toHaveText(mine); // kept
});

test("the build prompt can be changed, and writing a new one asks before it throws the change away (saying no changes nothing)", async ({ page }) => {
  await openDetails(page, own());
  const mine = `# My brief (${Date.now()})`;
  await page.getByRole("button", { name: "Edit the build prompt" }).click();
  await page.getByRole("textbox", { name: "AI build prompt" }).fill(mine);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("plan-text")).toContainText(mine);
  await expect(page.getByTestId("plan-edited")).toBeVisible();
  const asked: string[] = [];
  page.once("dialog", async (d) => { asked.push(d.message()); await d.dismiss(); });
  await page.getByRole("button", { name: "Write a new one" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("lose your changes");
  await expect(page.getByTestId("plan-text")).toContainText(mine); // nothing was replaced
});

test("the correction box saves what the owner says, and shows it back", async ({ page }) => {
  await openDetails(page, own());
  const note = `A ticket waiting for the customer is pending (${Date.now()}).`;
  const box = page.locator("#corrections-scope");
  await box.fill(note);
  await page.getByRole("button", { name: "Save only" }).first().click();
  await expect(page.getByTestId("corrections").first().getByRole("status")).toContainText("Saved");
  await page.reload();
  const toggle = page.getByRole("button", { name: /Details and overrides/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.locator("#corrections-scope")).toHaveValue(note);
});
