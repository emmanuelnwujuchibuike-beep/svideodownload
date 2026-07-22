/**
 * Governance manifest — the mandatory engineering gates, declared as data.
 *
 * The brief's "Engineering Intelligence™" / Development Workflow / Code Review
 * Standards, made real instead of prose: every standard the Constitution imposes
 * is one row here, pointing at the thing that ENFORCES it — a test that fails, an
 * npm script, a config file, or (honestly) a manual review step or an unbuilt
 * target. This is what turns "we have standards" into "here is each standard and
 * where it bites", and `governance.test.ts` asserts the automated ones point at
 * something that actually exists.
 *
 * Honesty rule (same as the Reality Ledger): a gate is only `automated` if a check
 * can fail on it. Standards we hold but haven't automated are `manual`; standards
 * we intend but haven't built (E2E, tracing, DORA metrics) are `planned` — never
 * dressed up as enforced.
 */

export type GateKind =
  /** A test that fails the suite. `enforcer` = repo-relative test file. */
  | "test"
  /** An npm script. `enforcer` = script name in package.json. */
  | "command"
  /** A config/rule file. `enforcer` = repo-relative path. */
  | "config"
  /** A human/tool review step. `enforcer` = the doc that defines it, or "". */
  | "manual"
  /** A standard we intend but have not automated. `enforcer` = "". */
  | "planned";

export type GateDomain =
  | "architecture"
  | "performance"
  | "security"
  | "accessibility"
  | "testing"
  | "database"
  | "api"
  | "observability"
  | "change-management"
  | "documentation"
  | "process";

export interface GovernanceGate {
  id: string;
  /** The standard. */
  name: string;
  /** One line: what it mandates. */
  requirement: string;
  domain: GateDomain;
  kind: GateKind;
  /** What enforces it — see `kind` for how to read this. */
  enforcer: string;
}

export const GATES: GovernanceGate[] = [
  /* ── architecture ── */
  { id: "module-boundaries", name: "Module isolation", requirement: "No module imports another's internal; core never imports a product.", domain: "architecture", kind: "config", enforcer: ".eslintrc.json" },
  { id: "load-time-guarantee", name: "Load-time guarantee", requirement: "A new product must not enlarge an existing route's bundle.", domain: "architecture", kind: "command", enforcer: "analyze" },
  { id: "constitution", name: "Constitution invariants", requirement: "Registry integrity + admin section↔panel↔icon wiring stay wired.", domain: "architecture", kind: "test", enforcer: "lib/platform/constitution.test.ts" },
  { id: "catalogue-honesty", name: "Catalogue honesty", requirement: "Every live/partial registry & service points at a file that exists.", domain: "architecture", kind: "test", enforcer: "lib/platform/platform-catalog.test.ts" },
  { id: "reality-ledger", name: "Reality Ledger", requirement: "No surface claims an unbuilt product or an unsourced number.", domain: "documentation", kind: "test", enforcer: "lib/content/reality-ledger.test.ts" },

  /* ── the always-run gates ── */
  { id: "typecheck", name: "Type safety", requirement: "The whole project typechecks with no errors.", domain: "process", kind: "command", enforcer: "typecheck" },
  { id: "lint", name: "Lint clean", requirement: "No lint errors.", domain: "process", kind: "command", enforcer: "lint" },
  { id: "unit-tests", name: "Unit tests", requirement: "Pure logic is unit-tested and green.", domain: "testing", kind: "command", enforcer: "test" },
  { id: "build", name: "Production build", requirement: "The app builds and prerenders without error.", domain: "process", kind: "command", enforcer: "build" },

  /* ── security & data ── */
  { id: "rls", name: "Row-Level Security", requirement: "A new table ships RLS policies in the same migration.", domain: "database", kind: "manual", enforcer: "docs/SECURITY.md" },
  { id: "input-validation", name: "Input validation", requirement: "Every external input is parsed with zod before use.", domain: "api", kind: "manual", enforcer: "docs/SECURITY.md" },
  { id: "rate-limit", name: "Rate limiting", requirement: "Mutations and the public API are rate-limited.", domain: "api", kind: "config", enforcer: "lib/rate-limit.ts" },
  { id: "security-review", name: "Security review", requirement: "Auth/data/endpoint changes get a security review before ship.", domain: "security", kind: "manual", enforcer: "docs/SECURITY.md" },

  /* ── performance & a11y ── */
  { id: "two-second-budget", name: "2-second page budget", requirement: "Cold entry to any page renders in ≤2s; measured on the live site.", domain: "performance", kind: "manual", enforcer: "docs/PERFORMANCE.md" },
  { id: "reduced-motion", name: "Reduced-motion baseline", requirement: "Every animation respects prefers-reduced-motion (app-wide MotionConfig).", domain: "accessibility", kind: "config", enforcer: "app/layout.tsx" },

  /* ── change management & observability ── */
  { id: "feature-flags", name: "Change management via flags", requirement: "Risky changes ship behind a flag with a kill switch + rollout.", domain: "change-management", kind: "config", enforcer: "lib/platform/flags.ts" },
  { id: "experiments", name: "Measured rollout", requirement: "Product bets can be A/B tested with logged exposures.", domain: "change-management", kind: "config", enforcer: "lib/platform/experiments.ts" },
  { id: "error-capture", name: "Error observability", requirement: "Client/server errors are captured, never swallowed silently.", domain: "observability", kind: "config", enforcer: "lib/observability/diagnostics.ts" },

  /* ── honest gaps (standards we hold, not yet automated) ── */
  { id: "e2e", name: "End-to-end tests", requirement: "Critical user journeys covered by browser smoke tests (Playwright).", domain: "testing", kind: "command", enforcer: "test:e2e" },
  { id: "tracing", name: "Distributed tracing", requirement: "Requests traced across the web tier and the worker.", domain: "observability", kind: "planned", enforcer: "" },
  { id: "eng-metrics", name: "Engineering metrics", requirement: "Deploy frequency, lead time, change-fail rate tracked (DORA).", domain: "process", kind: "planned", enforcer: "" },
];

export function getGates(): GovernanceGate[] {
  return GATES;
}

/** Counts by how strongly each gate is enforced — for the governance summary. */
export function gateSummary(): { automated: number; manual: number; planned: number; total: number } {
  const automated = GATES.filter((g) => g.kind === "test" || g.kind === "command" || g.kind === "config").length;
  const manual = GATES.filter((g) => g.kind === "manual").length;
  const planned = GATES.filter((g) => g.kind === "planned").length;
  return { automated, manual, planned, total: GATES.length };
}
