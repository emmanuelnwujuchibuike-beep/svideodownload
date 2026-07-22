import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests — the `e2e` governance gate (docs/CONSTITUTION.md, Art. X).
 *
 * Deliberately a THIN smoke layer, not a full E2E suite: it proves the critical
 * journeys render and the core endpoints answer, on top of the 698 unit tests —
 * not every interaction. The tests are written to survive without a live database
 * (the landing page is static, `/api/flags` degrades to defaults, `/api/health`
 * answers), so they run in CI without Supabase secrets.
 *
 * Not yet wired into the blocking CI job (.github/workflows/ci.yml) on purpose:
 * run `npm run test:e2e` locally first; add the job once it's green in the target
 * environment. Playwright manages its own TS compile — `e2e/` is excluded from the
 * app's tsconfig so `npm run typecheck` never touches it.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // A dev server compiles a heavy route on first hit; give navigation headroom.
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Start the app for the tests unless one is already running (or E2E_BASE_URL
  // points at a deployed environment).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
