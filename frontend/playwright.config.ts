import { defineConfig } from "@playwright/test";

/**
 * FA Public v1.0 end-to-end (real stack): PostgreSQL <- Express API (backend/dist) <- production static server (frontend/server) <- browser.
 * Requires E2E_DATABASE_URL pointing to an EMPTY, disposable PostgreSQL database (never a shared or cloud database). Migrations and the
 * catalog seed are applied by e2e/global-setup.ts. Runs at the two reference viewports: 375 (mobile) and 1440 (desktop).
 *   E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/beeside_fa4_e2e npm run test:e2e --workspace=frontend
 */
const DB = process.env.E2E_DATABASE_URL ?? "";
const WEB = 4177;
const API = 8087;
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  // bypassCSP only so axe-core can be injected; the production CSP itself is asserted by e2e/csp.spec.ts in a context without the bypass.
  use: { baseURL: `http://localhost:${WEB}`, trace: "retain-on-failure", bypassCSP: true },
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: `FA4_API_ENABLED=true DATABASE_URL=${DB} APP_BASE_URL=http://localhost:${WEB} RATE_LIMITING_ENABLED=false PORT=${API} node ../backend/dist/index.js`,
      url: `http://localhost:${API}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      // Same layout as the production image: static-server.mjs next to ./dist.
      command: `npx vite build && rm -rf .e2e-site && mkdir .e2e-site && cp -R dist .e2e-site/dist && cp server/static-server.mjs .e2e-site/ && API_UPSTREAM_URL=http://localhost:${API} PORT=${WEB} node .e2e-site/static-server.mjs`,
      url: `http://localhost:${WEB}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
