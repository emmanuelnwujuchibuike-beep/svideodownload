/**
 * Test-Type Registry — the kinds of automated test the platform runs, and honestly,
 * the kinds it doesn't yet. The brief's testing taxonomy, mapped to real harnesses.
 *
 * `live` types name a harness file that exists (checked by `quality.test.ts`);
 * `planned` types are the ones we've decided to add later, never dressed up as done
 * (no fake load/chaos/visual suites).
 */

export type TestTypeStatus = "live" | "planned";

export interface TestType {
  id: string;
  name: string;
  scope: string;
  /** Repo-relative harness (config/spec/test). Empty only when `planned`. */
  harness: string;
  status: TestTypeStatus;
  note?: string;
}

export const TEST_TYPES: TestType[] = [
  { id: "unit", name: "Unit", scope: "Pure logic across lib/**.", harness: "vitest.config.ts", status: "live" },
  { id: "contract", name: "API contract", scope: "Every /api/v1 endpoint ↔ its route/method.", harness: "lib/platform/api-registry.test.ts", status: "live" },
  { id: "integrity", name: "Registry integrity", scope: "Registries, catalogues and admin wiring can't drift.", harness: "lib/platform/constitution.test.ts", status: "live" },
  { id: "schema", name: "Schema conformance", scope: "Every real table is owned by a data domain.", harness: "lib/platform/data-domains.test.ts", status: "live" },
  { id: "performance-budget", name: "Performance budget", scope: "Per-route First-Load JS ceilings.", harness: "lib/perf/budget.test.ts", status: "live" },
  { id: "offline", name: "Offline behaviour", scope: "The offline action queue's decisions.", harness: "lib/offline/action-queue.test.ts", status: "live" },
  { id: "e2e", name: "End-to-end smoke", scope: "Critical journeys in a real browser.", harness: "playwright.config.ts", status: "live" },

  /* ── decided, not built (see Infrastructure Decisions where infra-backed) ── */
  { id: "component", name: "Component", scope: "Rendered React components in isolation.", harness: "", status: "planned", note: "React Testing Library not set up; unit + E2E cover the gap today." },
  { id: "integration", name: "Integration (DB)", scope: "Server logic against a real database.", harness: "", status: "planned", note: "Needs an ephemeral Supabase/Postgres in CI." },
  { id: "accessibility", name: "Accessibility (automated)", scope: "axe assertions on key screens.", harness: "", status: "planned" },
  { id: "visual-regression", name: "Visual regression", scope: "Screenshot diffs of critical screens.", harness: "", status: "planned", note: "Playwright supports it; awaiting a baseline decision." },
  { id: "cross-browser", name: "Cross-browser", scope: "Webkit + Firefox alongside Chromium.", harness: "", status: "planned", note: "Playwright projects; Chromium-only smoke today." },
  { id: "load", name: "Load / stress / soak", scope: "Throughput + endurance under traffic.", harness: "", status: "planned" },
  { id: "chaos", name: "Chaos / recovery", scope: "Failure injection + recovery validation.", harness: "", status: "planned" },
];

export function getTestTypes(): TestType[] {
  return TEST_TYPES;
}
