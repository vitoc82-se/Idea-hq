import { test, expect } from "@playwright/test";
import { failOnPageErrors } from "./helpers";

test.beforeEach(({ page }) => failOnPageErrors(page));

// A person who connected GitHub before Idea HQ asked which repositories are theirs (or added a repository to the app
// since) is told so, and gets a button that works, with the repository list showing. The sample data has no GitHub, so the
// panel's two answers are played by the test.
const REPOS = [{ owner: "acme", name: "app", defaultBranch: "main" }, { owner: "acme", name: "snitchbot-forever", defaultBranch: "main" }];

test("the repo panel offers Reconnect GitHub when access is not confirmed, and again when Save is refused for it", async ({ page }) => {
  await page.route("**/api/projects/p1/repo", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const r = await route.fetch();
      const j = await r.json();
      j.available = [{ installationId: 5, needsReconnect: true, configureUrl: "https://github.com/settings/installations/5", repos: REPOS }];
      return route.fulfill({ response: r, json: j });
    }
    if (req.method() === "PUT") return route.fulfill({ status: 409, json: { error: "Idea HQ has not yet confirmed which repositories you can open on GitHub. Press Reconnect GitHub, sign in once, then save again.", code: "reconnect" } });
    return route.continue();
  });
  await page.goto("/projects/p1/setup");
  const box = page.getByTestId("reconnect-github");
  await expect(box).toBeVisible();
  await expect(page.getByLabel("Repository").or(page.getByRole("combobox").first())).toBeVisible(); // the list is showing too
  await expect(box.getByRole("link", { name: "Reconnect GitHub" })).toHaveAttribute("href", "/api/github/install?next=%2Fprojects%2Fp1%2Fsetup");
  await page.getByRole("combobox").first().selectOption({ label: "acme/snitchbot-forever" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const refused = page.getByTestId("reconnect-github-error");
  await expect(refused).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Press Reconnect GitHub" })).toBeVisible();
  await expect(refused).toHaveAttribute("href", "/api/github/install?next=%2Fprojects%2Fp1%2Fsetup");
});

test("with access confirmed there is no reconnect box", async ({ page }) => {
  await page.route("**/api/projects/p1/repo", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch();
    const j = await r.json();
    j.available = [{ installationId: 5, needsReconnect: false, repos: REPOS }];
    return route.fulfill({ response: r, json: j });
  });
  await page.goto("/projects/p1/setup");
  await expect(page.getByRole("combobox").first()).toBeVisible();
  await expect(page.getByTestId("reconnect-github")).toHaveCount(0);
});
