import { defineConfig } from "@playwright/test";

/**
 * Smoke against the REAL closed production URL (no local servers).
 *   PROD_URL=https://discovery.beeside.you PROD_GATE_USER=… PROD_GATE_PASSWORD=… npx playwright test -c playwright.production.config.ts
 * The gate credentials come from the environment (read from Secret Manager by the operator's shell); they are never written to a file or printed.
 * Fictitious data only.
 */
const url = process.env.PROD_URL ?? "";
export default defineConfig({
  testDir: "e2e-production",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: url, trace: "off", bypassCSP: true },
  projects: [{ name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } }, { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } }],
});
