import { defineConfig } from "@playwright/test";

/**
 * Precision Center, LIVE: the production build of the customer app (VITE_PRECISION_API_MODE=live) served by the production static
 * server, talking through its /api proxy to the real backend (Express + manifests + conversation engine + delivery service) on real
 * PostgreSQL (database beeside_qa), with the isolated providers: scripted model, simulated Operation Hub, fixture entitlement and
 * fixture First Assessment context. Internal QA tooling.
 *
 * The backend is the QA composition (backend/scripts/precision-qa-server.ts): the same createApp/createPrecisionRuntime as
 * src/index.ts, plus per-project failure seams on the providers behind a loopback control port. Nothing in the product branches on it.
 *
 *   npx playwright test -c playwright.precision-live.config.ts                    # everything
 *   npx playwright test -c playwright.precision-live.config.ts --project=desktop-light
 *   PRECISION_LIVE_REUSE=1 ...                                                    # reuse servers that are already running
 *
 * Chromium is the pre-installed browser (never run `playwright install`). Screenshots: /tmp/precision-live-shots/<viewport>-<theme>-<locale>/.
 */
const FRONTEND_PORT = Number(process.env.PRECISION_LIVE_FRONTEND_PORT ?? 14181);
const BACKEND_PORT = Number(process.env.PRECISION_LIVE_BACKEND_PORT ?? 18081);
const CONTROL_PORT = Number(process.env.PRECISION_LIVE_CONTROL_PORT ?? 18082);
export const QA_CONTROL_KEY = process.env.QA_CONTROL_KEY ?? "qa-loopback-control-key-0001";
const DB = process.env.QA_DB ?? "beeside_qa";
const DATABASE_URL = process.env.QA_DATABASE_URL ?? `postgres://beeside:beeside@localhost:5432/${DB}`;
const executablePath = process.env.PRECISION_CHROMIUM ?? "/opt/pw-browsers/chromium";
const launchOptions = { executablePath, args: ["--no-proxy-server"] };
const desktop = { viewport: { width: 1440, height: 900 }, launchOptions };
const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, launchOptions };
const dist = "node_modules/.precision-live-qa";

export default defineConfig({
  testDir: "e2e/precision-live",
  timeout: 180_000,
  expect: { timeout: 12_000 },
  workers: Number(process.env.PRECISION_LIVE_WORKERS ?? 3),
  fullyParallel: true,
  reporter: [["list"]],
  // bypassCSP only so axe-core can be injected; the production CSP is served by the static server and checked in security.live.spec.ts.
  use: { baseURL: `http://localhost:${FRONTEND_PORT}`, trace: "retain-on-failure", bypassCSP: true },
  webServer: [
    {
      command: `bash ../scripts/precision-live-stack.sh ensure-db && cd ../backend && DATABASE_URL='${DATABASE_URL}' PORT=${BACKEND_PORT} CONTROL_PORT=${CONTROL_PORT} QA_CONTROL_KEY=${QA_CONTROL_KEY} DB_PRIVILEGE_CHECK=off NODE_ENV=development ALLOWED_ORIGINS=http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT} npx tsx scripts/precision-qa-server.ts`,
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: true,
      stdout: "pipe",
    },
    {
      command: `VITE_PRECISION_API_MODE=live npx vite build --outDir ${dist} --emptyOutDir && PORT=${FRONTEND_PORT} STATIC_ROOT=${dist} API_UPSTREAM_URL=http://127.0.0.1:${BACKEND_PORT} node server/static-server.mjs`,
      url: `http://127.0.0.1:${FRONTEND_PORT}/health`,
      timeout: 240_000,
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: "desktop-light", use: { ...desktop, colorScheme: "light" } },
    { name: "desktop-dark", use: { ...desktop, colorScheme: "dark" } },
    { name: "mobile-light", use: { ...mobile, colorScheme: "light" } },
    { name: "mobile-dark", use: { ...mobile, colorScheme: "dark" } },
  ],
});
