import { expect, type Page, type Locator } from "@playwright/test";

// Every page must load without an uncaught error in the browser.
export function failOnPageErrors(page: Page): void {
  page.on("pageerror", (e) => { throw new Error(`Uncaught error in the page ${page.url()}: ${e.message}`); });
}

// The row of an idea on the Ideas list, by the title it has in the sample data.
export function row(page: Page, title: string): Locator {
  return page.getByTestId("idea-row").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

export async function openIdeas(page: Page): Promise<void> {
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
  await expect(page.getByTestId("idea-row").first()).toBeVisible();
}

// What the card on an idea page says, once its builds have loaded.
export async function openIdea(page: Page, id: string): Promise<Locator> {
  await page.goto(`/ideas/${id}`);
  const card = page.locator("#journey");
  await expect(card).toBeVisible();
  await expect(card.getByText("Checking what a build would use")).toBeHidden({ timeout: 15_000 });
  return card;
}
