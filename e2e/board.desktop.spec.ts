import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdeas, row } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

// Each idea in the sample data is in a different stage; the row says which and what comes next.
const STAGES: [title: string, stage: string, next: string][] = [
  ["Imported idea one", "Describe · 1 of 5", "Plan it"],
  ["Rebuild the whole billing flow", "Describe · 1 of 5", "Split it into steps"],
  ["Add a footer link", "Plan · 2 of 5", "Build it"],
  ["Waiting on the footer", "Plan · 2 of 5", "Blocked by \"Add a footer link\""],
  ["Dark mode toggle", "Build · 3 of 5", "The AI is working on it"],
  ["Try me again", "Build · 3 of 5", "Try again"],
  ["Weekly email summary", "Review · 4 of 5", "Your project's checks are running"],
  ["Export to CSV", "Review · 4 of 5", "Ask the AI to fix it"],
  ["Search box", "Review · 4 of 5", "Merge"],
  ["Fix the typo", "Ship · 5 of 5", "Done: merged"],
  ["Maybe later", "", "Not planned for now"],
];

test("every row says its stage and what comes next", async ({ page }) => {
  await openIdeas(page);
  for (const [title, stage, next] of STAGES) {
    const r = row(page, title).getByTestId("idea-next");
    if (stage) await expect(r, title).toContainText(stage);
    await expect(r, title).toContainText(next);
  }
});

test("another person's idea never shows", async ({ page }) => {
  await openIdeas(page);
  await expect(page.getByText("Their secret idea")).toHaveCount(0);
});

test("the status reads In progress, not Building", async ({ page }) => {
  await openIdeas(page);
  await expect(row(page, "Dark mode toggle").getByRole("combobox", { name: "Status" })).toHaveValue("building");
  await expect(page.getByRole("button", { name: /in progress/i }).first()).toBeVisible();
  await expect(page.getByText("Building", { exact: true })).toHaveCount(0);
});

test("Needs you counts what waits for the owner and shows it most urgent first", async ({ page }) => {
  await openIdeas(page);
  const chip = page.getByRole("button", { name: /\d+ needs? you/ });
  await expect(chip).toContainText("5");
  await chip.click();
  const titles = await page.getByTestId("idea-row").getByRole("heading").allInnerTexts();
  expect(titles).toEqual(["Search box", "Export to CSV", "Try me again", "Add a footer link", "Rebuild the whole billing flow"]);
  await page.getByRole("button", { name: "Clear" }).click();
  expect(await page.getByTestId("idea-row").count()).toBeGreaterThan(5);
});

test("Plan them all offers the ideas that need a plan, and says plainly when the AI is not set up", async ({ page }) => {
  await openIdeas(page);
  await expect(page.getByText("3 ideas need a plan.")).toBeVisible();
  await page.getByRole("button", { name: "Plan them all" }).click();
  await expect(page.getByText(/not configured|AI estimation is not configured/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan them all" })).toBeEnabled(); // nothing is left spinning
});

test("search narrows the list and the next step on a row is a real, labelled button", async ({ page }) => {
  await openIdeas(page);
  await page.getByPlaceholder("Search ideas…").fill("footer");
  await expect(page.getByTestId("idea-row")).toHaveCount(2);
  const build = row(page, "Add a footer link").getByRole("link", { name: /Build it/ });
  await expect(build).toBeVisible();
  await expect(build).toHaveAccessibleName("Build it for Add a footer link");
  await build.click();
  await expect(page).toHaveURL(/\/ideas\/ready/);
});

test("the board view shows each card's stage and next step too", async ({ page }) => {
  await openIdeas(page);
  await page.getByRole("button", { name: "Board" }).click();
  const cards = page.getByTestId("kanban-next");
  await expect(cards.first()).toBeVisible();
  await expect(page.getByTestId("kanban-next").filter({ hasText: "Review · 4 of 5 · Merge" })).toHaveCount(1);
  await expect(page.getByTestId("kanban-next").filter({ hasText: "Describe · 1 of 5 · Plan it" })).toHaveCount(3);
  await expect(page.getByTestId("kanban-next").filter({ hasText: "Not planned for now" })).toHaveCount(1);
});
