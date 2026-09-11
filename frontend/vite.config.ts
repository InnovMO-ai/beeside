import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 1 skeleton config — real environment-specific API base URLs are wired
// in as the backend integrations land (Phase 4 onward), via env vars injected
// per environment (dev/staging/production), never hardcoded.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
