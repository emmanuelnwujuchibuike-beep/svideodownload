import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Deliberately minimal: this suite covers pure, side-effect-free logic
 * (ranking, personalization, offline-queue decisions, feed helpers) — no
 * DOM/jsdom environment or React Testing Library needed. Component/E2E
 * testing is a separate, bigger investment not attempted in this pass (see
 * docs/PROJECT_NOTES.md's Testing Strategy entry for why).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
