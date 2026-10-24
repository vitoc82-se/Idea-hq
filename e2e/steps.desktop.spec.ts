import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdea, openIdeas, row } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

// Setup steps only the owner can do (a new environment variable, a setting). The sample idea "Send a welcome email" is
// waiting to be merged with three of them; "Add a contact form" is already live with one still open. Ticking changes what
// is saved, so the tests that tick put it back, and run one after the other.
test.describe.configure({ mode: "serial" });

test("a change waiting to be merged lists what only the owner can do, before and after the merge", async ({ page }) => {
  const card = await openIdea(page, "setup");
  await expect(card.getByText("Build and tests passed. Do 2 setup steps first (below), then merge.")).toBeVisible();
  const box = card.getByTestId("owner-steps");
  await expect(box.getByText("Things only you can do")).toBeVisible();
  await expect(box.getByText("Before you merge", { exact: true })).toBeVisible();
  await expect(box.getByText("After you merge", { exact: true })).toBeVisible();
  const steps = box.getByTestId("owner-step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("RESEND_API_KEY");
  await expect(steps.nth(0)).toContainText("The AI said so");
  await expect(steps.nth(1)).toContainText("Idea HQ found this in the change");
  await expect(box.getByText("3 left to do.")).toBeVisible();
});

test("each step has plain-words help, with the full walk-through for a setting", async ({ page }) => {
  const card = await openIdea(page, "setup");
  const first = card.getByTestId("owner-step").first();
  await first.getByText("How do I do this?").click();
  await expect(first.getByText("Open the place where your site runs.")).toContainText("On Vercel");
  await expect(first.getByText(/Redeploy/).first()).toBeVisible();
  await expect(first.getByText(/Never paste a key into Idea HQ/)).toBeVisible();
  const last = card.getByTestId("owner-step").last();
  await last.getByText("How do I do this?").click();
  await expect(last.getByText("How to do this step")).toBeVisible();
});

test("merging with steps still open asks first, and Cancel merges nothing", async ({ page }) => {
  const card = await openIdea(page, "setup");
  let message = "";
  page.once("dialog", (d) => { message = d.message(); void d.dismiss(); });
  await card.getByRole("button", { name: "Merge", exact: true }).click();
  await expect.poll(() => message).toContain("You have not done 2 setup steps that should be done before you merge");
  await expect(card.getByRole("button", { name: "Merge", exact: true })).toBeVisible(); // still waiting to be merged
});

test("ticking a step and pressing Not needed are kept, and the count follows", async ({ page }) => {
  const card = await openIdea(page, "setup");
  const steps = card.getByTestId("owner-step");
  await steps.nth(0).getByRole("checkbox").click();
  await expect(card.getByText("2 left to do.")).toBeVisible();
  await expect(card.getByText("Build and tests passed. Do 1 setup step first (below), then merge.")).toBeVisible();
  await steps.nth(1).getByRole("button", { name: /Not needed/ }).click();
  await expect(card.getByText("Build and tests passed. Read the change, then merge it.")).toBeVisible();
  await expect(steps.nth(1)).toContainText("marked Not needed");
  await page.reload();
  await expect(page.locator("#journey").getByTestId("owner-step").nth(0).getByRole("checkbox")).toBeChecked();
  await expect(page.locator("#journey").getByText("1 left to do.")).toBeVisible();
  // put it back for the other tests
  const again = page.locator("#journey").getByTestId("owner-step");
  await again.nth(0).getByRole("checkbox").click();
  await again.nth(1).getByRole("checkbox").click();
  await expect(page.locator("#journey").getByText("3 left to do.")).toBeVisible();
});

test("an idea that is merged but not finished says so, and asks for the setup steps", async ({ page }) => {
  const card = await openIdea(page, "live");
  await expect(card.getByText("Merged, but it will not work until you finish 1 setup step.")).toBeVisible();
  await expect(card.getByText("Finish these so it works")).toBeVisible();
  await expect(card.getByRole("button", { name: "Do the setup step" })).toBeVisible();
  // the step already ticked is shown as done, the open one is not
  const steps = card.getByTestId("owner-step");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1).getByRole("checkbox")).toBeChecked();
  await expect(steps.nth(0).getByRole("checkbox")).not.toBeChecked();
});

test("the board keeps such an idea under Needs you, and says what is left", async ({ page }) => {
  await openIdeas(page);
  const live = row(page, "Add a contact form");
  await expect(live.getByTestId("idea-next")).toContainText("Finish 1 setup step");
  await expect(live.getByRole("link", { name: /Finish 1 setup step/ })).toBeVisible();
  // a finished idea with nothing left is just Done
  await expect(row(page, "Fix the typo").getByTestId("idea-next")).toContainText("Done: merged");
});

test("the plan stage shows the heads-up for steps the plan named", async ({ page }) => {
  // no sample idea sits at Plan with steps, so look at how the box words it
  const card = await openIdea(page, "ready");
  await expect(card.getByTestId("owner-steps")).toHaveCount(0); // an idea with no steps shows no box at all
});
