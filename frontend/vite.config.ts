import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app calls the API on the same origin (/api/fa). In local development Vite forwards /api to
// the backend (override with VITE_DEV_API_TARGET); deployed environments route it at the edge.
//
// DEV-ONLY remote-QA path (Macroblock 7 — Local QA Path Fix, 2026-09-29): `deploy-dev.yml` only
// deploys Cloud Run dev from `main`, so a feature branch's Snapshot changes are never visible on the
// deployed dev frontend until merge — merging just to QA is exactly what this avoids. The backend's
// origin guard (`backend/src/security/http-hardening.ts` originGuard, fed from the server-side
// `ALLOWED_ORIGINS` env var — unchanged by this file) rejects any state-changing request whose
// `Origin` header isn't on its allow-list. Pointing this local dev server at the real Cloud Run dev
// backend (via VITE_DEV_API_TARGET) still fails that guard, because the browser's real Origin is
// `http://localhost:<port>`, which was never meant to be on that list.
//
// VITE_DEV_API_ORIGIN closes that gap on the proxy side only: when set, the local dev proxy rewrites
// the outgoing `Origin` header — on requests it forwards to the Cloud Run dev backend, and only
// there — to the dev frontend origin already approved in that backend's own ALLOWED_ORIGINS. Nothing
// about the guard, the allow-list, Cloud Run's security policy, or TLS validation changes; a real
// browser can never set its own Origin header (it's a forbidden header for fetch/XHR), so this only
// ever takes effect inside this local, explicitly-opted-into dev proxy. It also cannot reach
// production: `server.proxy` is a `vite dev`-only feature with no role in `vite build`'s output or
// in the deployed app.
//
// Both variables are additive and opt-in — set neither, and the default localhost → localhost dev
// path (`npm run dev` against a locally-running backend on :8080) is exactly as it was before.
const devApiTarget = process.env.VITE_DEV_API_TARGET ?? "http://localhost:8080";
const devApiOrigin = process.env.VITE_DEV_API_ORIGIN;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: true,
        // Only registered when VITE_DEV_API_ORIGIN is explicitly set — see the comment above.
        ...(devApiOrigin
          ? {
              // `proxy` is the underlying `http-proxy` server instance Vite's dev server uses;
              // vite.config.ts sits outside tsconfig.json's `include` (like every Vite config) and is
              // transpiled, not type-checked, so an explicit `http-proxy` type import isn't needed here.
              configure: (proxy: any) => {
                proxy.on("proxyReq", (proxyReq: any) => {
                  proxyReq.setHeader("origin", devApiOrigin);
                });
              },
            }
          : {}),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
