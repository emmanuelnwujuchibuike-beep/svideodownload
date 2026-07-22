/**
 * Certification Engine — production-readiness certifications derived from the real
 * governance gates. The brief's "Certification Engine™", honest by construction: a
 * certification isn't a badge someone grants, it's a FUNCTION of which gates back it
 * and how strongly each is enforced. So it can't lie — if a backing gate is only
 * `planned`, the certification reports a `gap`, not "certified".
 *
 *   automated — every backing gate is machine-enforced (test/command/config).
 *   attested  — all backing gates exist, but some are `manual` (need a human sign-off).
 *   gap       — a backing gate is `planned` or missing; the cert can't be claimed yet.
 */
import { type GovernanceGate, getGates } from "./governance";

export type CertReadiness = "automated" | "attested" | "gap";

export interface Certification {
  id: string;
  name: string;
  description: string;
  /** Governance gate ids that back this certification (must all exist). */
  gates: string[];
}

export const CERTIFICATIONS: Certification[] = [
  {
    id: "architecture",
    name: "Architecture Certified",
    description: "Module isolation, registry integrity and the load-time guarantee hold.",
    gates: ["module-boundaries", "constitution", "catalogue-honesty", "load-time-guarantee"],
  },
  {
    id: "security",
    name: "Security Certified",
    description: "RLS, validation, rate limiting, review and dependency/secret hygiene.",
    gates: ["rls", "input-validation", "rate-limit", "security-review", "dependency-audit", "secret-detection"],
  },
  {
    id: "accessibility",
    name: "Accessibility Certified",
    description: "Reduced-motion baseline plus automated a11y assertions.",
    gates: ["reduced-motion", "a11y-automation"],
  },
  {
    id: "performance",
    name: "Performance Certified",
    description: "The 2-second budget and the load-time guarantee.",
    gates: ["two-second-budget", "load-time-guarantee"],
  },
  {
    id: "localization",
    name: "Localization Certified",
    description: "The locale + translation catalogue stays consistent.",
    gates: ["localization"],
  },
  {
    id: "quality",
    name: "Quality Certified",
    description: "Types, lint, unit, contract and E2E all green, and it builds.",
    gates: ["typecheck", "lint", "unit-tests", "api-contract", "e2e", "build"],
  },
  {
    id: "production-ready",
    name: "Production Ready",
    description: "The union of the critical gates a change must clear to ship.",
    gates: [
      "typecheck",
      "lint",
      "unit-tests",
      "build",
      "constitution",
      "reality-ledger",
      "two-second-budget",
      "rls",
      "security-review",
      "e2e",
    ],
  },
];

export interface CertStatus {
  cert: Certification;
  readiness: CertReadiness;
  automated: number;
  manual: number;
  planned: number;
  /** Backing gate ids that don't exist in the manifest (a wiring bug). */
  missing: string[];
}

/** Certify one certification against a set of gates. Pure. */
export function certify(cert: Certification, gates: GovernanceGate[]): CertStatus {
  const byId = new Map(gates.map((g) => [g.id, g]));
  let automated = 0;
  let manual = 0;
  let planned = 0;
  const missing: string[] = [];
  for (const id of cert.gates) {
    const g = byId.get(id);
    if (!g) {
      missing.push(id);
      continue;
    }
    if (g.kind === "test" || g.kind === "command" || g.kind === "config") automated++;
    else if (g.kind === "manual") manual++;
    else planned++; // "planned"
  }
  const readiness: CertReadiness =
    missing.length > 0 || planned > 0 ? "gap" : manual > 0 ? "attested" : "automated";
  return { cert, readiness, automated, manual, planned, missing };
}

/** Certify every certification against the live governance manifest. */
export function certifyAll(): CertStatus[] {
  const gates = getGates();
  return CERTIFICATIONS.map((c) => certify(c, gates));
}

export function getCertifications(): Certification[] {
  return CERTIFICATIONS;
}
