import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/production",
  testMatch: "**/*.spec.ts",
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  workers: 1,
  outputDir: "test-results-production",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-production" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:4173",
    viewport: { width: 1480, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: [
    { command: "npx vite preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 30_000 },
    { command: "node server/sandbox-server.mjs", url: "http://127.0.0.1:5174/runtime.html", reuseExistingServer: !process.env.CI, timeout: 30_000 },
  ],
});
