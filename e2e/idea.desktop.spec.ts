import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdea } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

test("a planned idea: Build it says the most it should cost, sizes speak minutes and cost, turns stay under Adjust", async ({ page }) => {
  const card = await openIdea(page, "ready");
  await expect(card.getByText("Planned. Ready to build.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Build it, up to $0.05" })).toBeEnabled();
  await expect(card.getByText("Quick: typically 4 to 8 minutes, $0.01 to $0.05")).toBeVisible();
  await expect(card.getByTestId("own-history")).toContainText(/Your last \d+ Quick changes took 4 to 7 minutes and cost \$0\.01 to \$0\.04\./);
  const text = await card.innerText();
  expect(text).not.toMatch(/\d+ to \d+ turns|limit of \d+|It will use/);
  await expect(card.getByRole("button", { name: "Adjust model and turns" })).toBeVisible();
  await expect(card.getByRole("combobox", { name: "Size" })).toContainText("Quick: 4 to 8 minutes");
});

test("an unplanned idea starts with Plan it, which is not held back while builds load", async ({ page }) => {
  const card = await openIdea(page, "n1");
  await expect(card.getByRole("button", { name: "Plan it" })).toBeEnabled();
});

test("a finished change waiting to be merged says what Merge does and how to undo it", async ({ page }) => {
  const card = await openIdea(page, "green");
  await expect(card.getByText("Build and tests passed. Read the change, then merge it.")).toBeVisible();
  await expect(card.getByTestId("merge-explained")).toContainText("Merge puts this change into main of acme/app");
  await expect(card.getByTestId("merge-explained")).toContainText("You can undo it afterwards with Revert this change");
  await expect(card.getByText("$0.04 · 5 minutes")).toBeVisible();
  await expect(card.getByRole("button", { name: "Merge", exact: true })).toBeEnabled();
});

test("failed checks offer to ask the AI to fix them", async ({ page }) => {
  const card = await openIdea(page, "red");
  await expect(card.getByText("The checks failed. The AI can try to fix it.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Ask the AI to fix it" })).toBeVisible();
});

test("while the AI works there is no button to press, only Cancel run", async ({ page }) => {
  const card = await openIdea(page, "busy");
  await expect(card.getByText("The AI is working on it.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Cancel run" })).toBeVisible();
  await expect(card.getByRole("button", { name: /Build it/ })).toHaveCount(0);
});

test("a failed run says so and offers Try again", async ({ page }) => {
  const card = await openIdea(page, "failed");
  await expect(card.getByText("That run did not finish.")).toBeVisible();
  await expect(card.getByText("The AI made no changes.")).toBeVisible();
  await expect(card.getByRole("button", { name: /Try again/ })).toBeVisible();
});

test("an idea waiting on another is not offered a build and says which", async ({ page }) => {
  const card = await openIdea(page, "wait");
  await expect(card.getByText(/Blocked by "Add a footer link"/)).toBeVisible();
  await expect(card.getByRole("button", { name: /Build it/ })).toHaveCount(0);
});

test("an Epic is offered a split first, and can still be built as one", async ({ page }) => {
  const card = await openIdea(page, "big");
  await expect(card.getByRole("button", { name: "Split it into steps" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Build it as one anyway" })).toBeVisible();
});

test("an idea split into steps points at the next step", async ({ page }) => {
  const card = await openIdea(page, "epic");
  await expect(card.getByText(/split into 2 steps \(1 to go\)/)).toBeVisible();
  await expect(card.getByRole("link", { name: "Open the next step" })).toHaveAttribute("href", "/ideas/k2");
});

test("a shipped change says what it took and offers Revert in place", async ({ page }) => {
  const card = await openIdea(page, "done");
  await expect(card.getByText("Merged. The idea is done.")).toBeVisible();
  await expect(card.getByText(/This took about 5 minutes and \$0\.03\./)).toBeVisible();
  await expect(card.getByTestId("undo")).toContainText("Changed your mind?");
  await expect(card.getByRole("button", { name: "Revert this change" })).toBeVisible();
});

test("a revert that is waiting is pointed out instead of offering another", async ({ page }) => {
  const card = await openIdea(page, "rv");
  await expect(card.getByTestId("undo")).toContainText("A revert is waiting for you");
  await expect(card.getByRole("button", { name: "Open the revert" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Revert this change" })).toHaveCount(0);
});

test("everything else is folded into one row that opens", async ({ page }) => {
  await openIdea(page, "ready");
  const toggle = page.getByRole("button", { name: /Details and overrides/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
