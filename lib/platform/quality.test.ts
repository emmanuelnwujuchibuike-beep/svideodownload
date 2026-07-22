import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Certification,
  certify,
  certifyAll,
  getCertifications,
} from "./certification";
import { type GovernanceGate, getGates } from "./governance";
import { getInfraDecisions } from "./infra-decisions";
import { getTestTypes } from "./test-types";

const ROOT = path.resolve(__dirname, "../..");

/* ------------------------------ infra decisions ---------------------------- */

describe("Infrastructure Decisions", () => {
  it("each decision is complete, unique and validly staged", () => {
    const seen = new Set<string>();
    for (const d of getInfraDecisions()) {
      expect(seen.has(d.id), `duplicate decision id: "${d.id}"`).toBe(false);
      seen.add(d.id);
      expect(["decided", "adopted"]).toContain(d.status);
      for (const field of [d.capability, d.decision, d.rationale, d.trigger]) {
        expect(field.length, `"${d.id}" has an empty field`).toBeGreaterThan(0);
      }
    }
  });
});

/* -------------------------------- test types ------------------------------- */

describe("Test-Type Registry", () => {
  it("live types name a harness that exists; planned name none", () => {
    const problems: string[] = [];
    for (const t of getTestTypes()) {
      if (t.status === "planned") {
        if (t.harness !== "") problems.push(`"${t.id}" is planned but names a harness`);
      } else if (!t.harness) {
        problems.push(`"${t.id}" is live but names no harness`);
      } else if (!existsSync(path.join(ROOT, t.harness))) {
        problems.push(`"${t.id}" harness "${t.harness}" does not exist`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

/* ------------------------------- certification ----------------------------- */

describe("Certification Engine — backing gates are real", () => {
  it("every certification references only gates that exist (no dangling refs)", () => {
    const statuses = certifyAll();
    const dangling = statuses.flatMap((s) =>
      s.missing.map((id) => `${s.cert.id} → unknown gate "${id}"`),
    );
    expect(dangling, dangling.join("\n")).toEqual([]);
  });
});

describe("Certification Engine — readiness is honest", () => {
  const gates: GovernanceGate[] = [
    { id: "auto1", name: "", requirement: "", domain: "process", kind: "test", enforcer: "x" },
    { id: "auto2", name: "", requirement: "", domain: "process", kind: "command", enforcer: "x" },
    { id: "man1", name: "", requirement: "", domain: "process", kind: "manual", enforcer: "x" },
    { id: "plan1", name: "", requirement: "", domain: "process", kind: "planned", enforcer: "" },
  ];
  const cert = (gateIds: string[]): Certification => ({ id: "c", name: "", description: "", gates: gateIds });

  it("all-automated ⇒ automated", () => {
    expect(certify(cert(["auto1", "auto2"]), gates).readiness).toBe("automated");
  });
  it("any manual (no planned/missing) ⇒ attested", () => {
    expect(certify(cert(["auto1", "man1"]), gates).readiness).toBe("attested");
  });
  it("any planned ⇒ gap", () => {
    expect(certify(cert(["auto1", "plan1"]), gates).readiness).toBe("gap");
  });
  it("a missing backing gate ⇒ gap, and is reported", () => {
    const s = certify(cert(["auto1", "ghost"]), gates);
    expect(s.readiness).toBe("gap");
    expect(s.missing).toContain("ghost");
  });
});

describe("Certification Engine — the real certifications reflect reality", () => {
  it("reads a sensible picture from the live manifest", () => {
    const byId = new Map(certifyAll().map((s) => [s.cert.id, s]));
    // Architecture is fully machine-enforced.
    expect(byId.get("architecture")?.readiness).toBe("automated");
    // Security has a planned gate (secret-detection) ⇒ an honest gap, not a badge.
    expect(byId.get("security")?.readiness).toBe("gap");
    // Production-ready leans on manual review gates ⇒ needs attestation.
    expect(byId.get("production-ready")?.readiness).toBe("attested");
  });

  it("covers every declared certification", () => {
    expect(certifyAll().length).toBe(getCertifications().length);
  });
});
