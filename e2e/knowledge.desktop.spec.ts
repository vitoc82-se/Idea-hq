import { test, expect } from "@playwright/test";
import { failOnPageErrors, openIdea } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

// The sample project's knowledge went stale the way a real one does: every topic confirmed long ago, and a later scan
// found something different for "How it is organised". That must be visible everywhere, never "up to date".
test("the knowledge page shows the confirmed text, the scan's suggestion next to it, and says there is something to review", async ({ page }) => {
  await page.goto("/projects/p1/knowledge");
  await expect(page.getByRole("heading", { name: /What Idea HQ knows about/ })).toBeVisible();
  const notice = page.getByTestId("suggestions-notice");
  await expect(notice).toContainText("Suggested changes to review");
  await expect(notice).toContainText("1 topic you confirmed");
  const suggestion = page.getByTestId("suggestion");
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toContainText("SupportTicket, TicketMessage, GiftCard");
  await expect(suggestion.getByRole("button", { name: "Use the new text" })).toBeEnabled();
  await expect(suggestion.getByRole("button", { name: "Keep mine" })).toBeEnabled();
  // the old, confirmed text is still what is shown as the topic's text, and it says how old it is
  await expect(page.getByText("models User, Product, Order.", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/last changed/).first()).toBeVisible();
  await expect(page.getByText("Suggested change", { exact: true })).toBeVisible();
  await expect(page.getByText(/up.to.date/i)).toHaveCount(0);
});

test("an idea in that project says so above the journey card, with a link to review", async ({ page }) => {
  const card = await openIdea(page, "ready");
  const notice = page.getByTestId("knowledge-notice");
  await expect(notice).toContainText("suggests changes to 1 topic you confirmed");
  await expect(notice.getByRole("link", { name: "Review the suggestions" })).toHaveAttribute("href", "/projects/p1/knowledge");
  // it sits above the card, so it is read before an estimate or a plan is asked for
  const [n, c] = await Promise.all([notice.boundingBox(), card.boundingBox()]);
  expect(n!.y).toBeLessThan(c!.y);
});

test("the project list asks for the review too", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Review them" })).toHaveAttribute("href", "/projects/p1/knowledge");
});
