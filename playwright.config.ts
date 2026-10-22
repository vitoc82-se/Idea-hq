import { defineConfig, devices } from "@playwright/test";

// Smoke tests for the main screens, against a production build that runs on the in-memory database with sample data
// (scripts/local.mjs, src/lib/dev-seed.ts). `npm run test:e2e` builds it first; `npm run test:e2e:fast` reuses a build.
const PORT = Number(process.env.PORT || 3100);
export const AUTH_FILE = "e2e/.auth/dev.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Signed out: the public pages and the sign-in form.
    { name: "signed-out", testMatch: /signed-out\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // Signed in as the sample owner, on a desktop and on a phone.
    { name: "desktop", testMatch: /\.desktop\.spec\.ts/, use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE }, dependencies: ["setup"] },
    { name: "phone", testMatch: /\.phone\.spec\.ts/, use: { ...devices["Pixel 7"], storageState: AUTH_FILE }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "node scripts/local.mjs start",
    url: `http://localhost:${PORT}/auth/signin`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
