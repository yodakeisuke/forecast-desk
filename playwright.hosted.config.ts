import { defineConfig } from "@playwright/test";
import production from "./playwright.production.config";

export default defineConfig({
  ...production,
  webServer: undefined,
  outputDir: "test-results-hosted",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-hosted" }]],
  use: { ...production.use, baseURL: "https://forecast-desk-kei.keiyoda.chatgpt.site" },
});
