import { defineConfig } from "@playwright/test";

// Drives the built desktop app through WebView2's DevTools port (see e2e/app.ts).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
});
