import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app calls the API on the same origin (/api/fa). In local development Vite forwards /api to
// the backend (override with VITE_DEV_API_TARGET); deployed environments route it at the edge.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.VITE_DEV_API_TARGET ?? "http://localhost:8080", changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
  },
});
