import { defineConfig, devices } from "@playwright/test";

// Starts both origins (app on localhost:5173, GenUI sandbox on 127.0.0.1:5174) unless they already run.
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    viewport: { width: 1480, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5174/runtime.html",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
