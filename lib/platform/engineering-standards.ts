/**
 * Engineering Standards — the conventions every contributor and AI assistant
 * follows in this repo, as DATA.
 *
 * The Developer Experience brief's "Engineering Standards" section, made honest:
 * each standard names how it is ENFORCED (a tool, a test, a build gate) and a
 * real reference file that embodies it — not an aspiration. `engineering.test.ts`
 * asserts every named reference exists, so a standard can't cite a file that
 * isn't there. Where a standard is a review-time convention rather than a
 * mechanical gate, it says so.
 */

export type StandardArea =
  | "structure"
  | "naming"
  | "typescript"
  | "formatting"
  | "linting"
  | "testing"
  | "errors"
  | "comments"
  | "dependencies"
  | "boundaries"
  | "performance"
  | "truth";

export interface EngineeringStandard {
  id: string;
  area: StandardArea;
  /** The rule, in one line. */
  rule: string;
  /** How it is enforced — the tool, test or gate (or "review" when it's human). */
  howEnforced: string;
  /** A repo-relative file that embodies or enforces it. Empty only when purely conventional. */
  reference: string;
}

export const ENGINEERING_STANDARDS: EngineeringStandard[] = [
  {
    id: "structure",
    area: "structure",
    rule: "Routes in app/, feature code in features/<feature>/, shared logic in lib/. A feature owns its UI + client stores; server-only logic lives in lib/*.",
    howEnforced: "Convention + the module registry, which maps every product surface to its owning code.",
    reference: "docs/ARCHITECTURE.md",
  },
  {
    id: "naming",
    area: "naming",
    rule: "kebab-case files, PascalCase components/types, camelCase functions, snake_case DB tables + analytics event ids.",
    howEnforced: "ESLint for code; the catalogue test pins snake_case event ids.",
    reference: "lib/platform/platform-catalog.test.ts",
  },
  {
    id: "typescript",
    area: "typescript",
    rule: "TypeScript strict, including noUncheckedIndexedAccess — indexed access is possibly-undefined and must be guarded.",
    howEnforced: "`npm run typecheck` (tsc --noEmit) in CI and before every commit.",
    reference: "tsconfig.json",
  },
  {
    id: "formatting",
    area: "formatting",
    rule: "Prettier owns formatting; never hand-format or argue style in review.",
    howEnforced: "`npm run format` (prettier --write).",
    reference: "package.json",
  },
  {
    id: "linting",
    area: "linting",
    rule: "ESLint (next lint) must pass with no errors; unused vars and floating promises are caught.",
    howEnforced: "`npm run lint`.",
    reference: "package.json",
  },
  {
    id: "testing",
    area: "testing",
    rule: "Vitest units (*.test.ts) must have TEETH — a guard proves it can fail on a bad fixture; Playwright (*.spec.ts) for E2E. Assert on the real artifact, not a green checkmark.",
    howEnforced: "`npm test`; the Test-Type Registry catalogues each kind.",
    reference: "lib/platform/test-types.ts",
  },
  {
    id: "errors",
    area: "errors",
    rule: "Fail OPEN on non-critical reads (auth resolution, ad fills); never gate a critical action (sign-out) on a server round-trip; every fire-and-forget write is caught.",
    howEnforced: "Review + the incident record that motivated each rule.",
    reference: "docs/SECURITY.md",
  },
  {
    id: "comments",
    area: "comments",
    rule: "Comments explain WHY (the decision, the trap avoided), not what the code plainly does, and match the surrounding density.",
    howEnforced: "Review, against the constitution's authoring rules.",
    reference: "docs/CONSTITUTION.md",
  },
  {
    id: "dependencies",
    area: "dependencies",
    rule: "Patch transitive vulnerabilities with npm `overrides` (non-breaking); always commit the lockfile.",
    howEnforced: "`npm run deps:audit` (npm audit --omit=dev --audit-level=high).",
    reference: "package.json",
  },
  {
    id: "boundaries",
    area: "boundaries",
    rule: "lib/sdk is dependency- and framework-free (publishable to npm); codegen inputs (design-tokens.ts) carry no @/ imports; server-only modules import 'server-only'.",
    howEnforced: "The production build fails if a server-only module reaches a client bundle.",
    reference: "lib/sdk/index.ts",
  },
  {
    id: "performance",
    area: "performance",
    rule: "The 2-second cold-entry budget is the #1 rule; cold-entry route JS weight is a ratchet that only moves down without written justification.",
    howEnforced: "`lib/perf/budget.test.ts` measures the build manifest against the ceiling.",
    reference: "lib/perf/budget.test.ts",
  },
  {
    id: "truth",
    area: "truth",
    rule: "A `live` registry entry points at a file that exists; no fabricated statistics are ever shown — a real measured number or nothing.",
    howEnforced: "The catalogue tests assert sources exist; review enforces the no-fabrication rule.",
    reference: "docs/CONSTITUTION.md",
  },
];

export function getEngineeringStandards(): EngineeringStandard[] {
  return ENGINEERING_STANDARDS;
}

export const STANDARD_AREAS: { id: StandardArea; label: string }[] = [
  { id: "structure", label: "Project structure" },
  { id: "naming", label: "Naming" },
  { id: "typescript", label: "TypeScript" },
  { id: "formatting", label: "Formatting" },
  { id: "linting", label: "Linting" },
  { id: "testing", label: "Testing" },
  { id: "errors", label: "Error handling" },
  { id: "comments", label: "Comments" },
  { id: "dependencies", label: "Dependencies" },
  { id: "boundaries", label: "Architecture boundaries" },
  { id: "performance", label: "Performance" },
  { id: "truth", label: "Truth & honesty" },
];
