import { defineConfig } from "@playwright/test";

/**
 * Precision Center customer app (frontend/src/precision), end to end against the in-memory API adapter.
 * The app is built with VITE_PRECISION_API_MODE=mock (into node_modules/.precision-mock, which is never committed) and served by `vite preview`; no database or backend is needed.
 * Chromium is the pre-installed browser (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); never run `playwright install`.
 *   npx playwright test -c playwright.precision.config.ts
 * Viewports: desktop 1440x900 and mobile 390x844, each in light and dark. Dark is the real prefers-color-scheme media feature.
 */
const PORT = 4178;
const executablePath = process.env.PRECISION_CHROMIUM ?? "/opt/pw-browsers/chromium";
const launchOptions = { executablePath, args: ["--no-proxy-server"] };
const desktop = { viewport: { width: 1440, height: 900 }, launchOptions };
const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, launchOptions };

export default defineConfig({
  testDir: "e2e/precision",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  fullyParallel: true,
  reporter: [["list"]],
  // bypassCSP only so axe-core can be injected; the production CSP is covered by e2e/csp.spec.ts.
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", bypassCSP: true },
  webServer: {
    command: `VITE_PRECISION_API_MODE=mock npx vite build --outDir node_modules/.precision-mock && npx vite preview --outDir node_modules/.precision-mock --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/precision/`,
    timeout: 180_000,
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop-light", use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", use: { ...desktop, colorScheme: "dark" } },
    { name: "mobile-light", use: { ...mobile, colorScheme: "light" } },
    { name: "mobile-dark", use: { ...mobile, colorScheme: "dark" } },
  ],
});
