import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against a production build (`pnpm build` first). CI installs Playwright's
 * Chromium; locally the installed Google Chrome is used, so nothing extra downloads.
 *   pnpm test:e2e
 */
const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) } },
    { name: "phone", use: { ...devices["Pixel 7"], ...(process.env.CI ? {} : { channel: "chrome" }) }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    command: "pnpm start",
    url: `http://localhost:${PORT}`,
    // Signed-out pages only: placeholders so sign-in shows as configured. Nothing connects to them.
    env: {
      PORT: String(PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://e2e:e2e@127.0.0.1:1/e2e",
      BETTER_AUTH_SECRET: "e2e-placeholder-secret-not-used-for-real-sessions",
      RESEND_API_KEY: "e2e-placeholder",
      EMAIL_FROM: "Flyer Studio <e2e@example.test>",
      MAINTENANCE: "off",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
