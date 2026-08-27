import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.stubs/resize-observer.ts"],
    // Playwright specs live in e2e/**/*.spec.ts — Vitest's default include pattern
    // (**/*.{test,spec}.*) would otherwise pick them up and fail on `test.describe`.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(import.meta.dirname, "./vitest.stubs/server-only.ts"),
    },
  },
});
