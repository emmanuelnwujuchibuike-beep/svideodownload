import { describe, expect, it } from "vitest";

import { DATA_DOMAINS } from "@/lib/platform/data-domains";

import { PORTABILITY, portabilityFor, undeclaredDomains } from "./registry";
import { exportPlan, NOT_EXPORTED, OWNER_COLUMN, SECRET_TABLES } from "./tables";

/**
 * Data Portability™ — the completeness guarantee.
 *
 * ── What went wrong before ───────────────────────────────────────────────────
 * `/api/account/export` hand-listed NINE tables. The schema has ninety-four in
 * the personal domains alone. The export was therefore not incorrect, it was
 * silently incomplete — and getting worse by itself, because every table added
 * afterwards was absent and nothing anywhere failed. A subject access request
 * returned a file that looked whole.
 *
 * These tests are the mechanism that makes it impossible to be quietly wrong
 * again: every table in an exportable domain must have a decision, and every
 * refusal must have a reason somebody wrote down.
 */

describe("every domain has a portability decision", () => {
  it("leaves no catalogued domain undeclared", () => {
    /*
      The guard one level up (`data-domains.test.ts`) already fails when a
      migration adds a table with no domain. This is the same shape applied to
      domains: a new domain cannot ship without someone deciding whether its
      contents belong to the member.
    */
    expect(
      undeclaredDomains(),
      `Domains with no portability decision: ${undeclaredDomains().join(", ")}`,
    ).toHaveLength(0);
  });

  it("declares nothing that is not a real domain", () => {
    const real = new Set(DATA_DOMAINS.map((d) => d.id));
    const ghosts = PORTABILITY.filter((p) => !real.has(p.domain)).map((p) => p.domain);
    expect(ghosts, `Portability entries for domains that do not exist: ${ghosts.join(", ")}`).toHaveLength(0);
  });

  it("justifies every restriction in writing", () => {
    // "We withheld it" is a claim that needs a reason per domain, not a
    // category. Each of these is shown to the person who asked for their data.
    for (const spec of PORTABILITY.filter((p) => p.dataClass === "restricted")) {
      expect(spec.withheldBecause, `${spec.domain} is restricted with no explanation`).toBeTruthy();
      expect(spec.withheldBecause!.length, `${spec.domain}'s explanation is too thin`).toBeGreaterThan(80);
    }
  });

  it("explains every domain in words a person can read", () => {
    for (const spec of PORTABILITY) {
      expect(spec.holds.length, `${spec.domain} has no description`).toBeGreaterThan(20);
      expect(spec.purpose.length, `${spec.domain} does not say why it exists`).toBeGreaterThan(20);
      expect(spec.retention.length, `${spec.domain} does not state retention`).toBeGreaterThan(10);
      // "Varies" is not a retention policy.
      expect(spec.retention.toLowerCase()).not.toMatch(/^varies|^depends|^n\/a/);
    }
  });
});

describe("every exportable table has a decision", () => {
  const plan = exportPlan();

  it("leaves nothing undecided", () => {
    /*
      THE test. A new table lands in a catalogued domain and this goes red until
      somebody says whether it is exported and, if not, why. The old hand-written
      export had no equivalent, which is exactly how it drifted to covering nine
      tables out of ninety-four.
    */
    expect(
      plan.undecided,
      `Tables in an exportable domain with no export decision:\n  ${plan.undecided.join("\n  ")}\n\n` +
        `Add an owner column to OWNER_COLUMN, or a reason to NOT_EXPORTED.`,
    ).toHaveLength(0);
  });

  it("actually covers a substantial part of the schema", () => {
    // Guards against the whole thing passing because the plan is empty.
    expect(plan.included.length).toBeGreaterThan(50);
  });

  it("never puts a table in both lists", () => {
    const both = Object.keys(OWNER_COLUMN).filter((t) => t in NOT_EXPORTED);
    expect(both, `Tables both exported and excluded: ${both.join(", ")}`).toHaveLength(0);
  });

  it("gives every exclusion a reason a person could read", () => {
    for (const [table, reason] of Object.entries(NOT_EXPORTED)) {
      expect(reason.length, `${table}'s exclusion reason is too thin`).toBeGreaterThan(25);
      expect(reason.endsWith("."), `${table}'s reason should read as a sentence`).toBe(true);
    }
  });
});

describe("secrets never leave the server", () => {
  it("excludes every credential table from the export", () => {
    /*
      An export is a plain file that lands in a Downloads folder and is often
      forwarded to whoever asked for it. Recovery codes, PIN material and
      private encryption keys inside it turn data portability into credential
      disclosure — a legitimate request with a compromised account at the end.

      "It is their own data" is true and is not the test. The test is whether
      handing it over in this form leaves them safer or less safe.
    */
    for (const table of Object.keys(SECRET_TABLES)) {
      expect(OWNER_COLUMN[table], `${table} holds credentials and must not be exported`).toBeUndefined();
      expect(NOT_EXPORTED[table], `${table} must state why it is withheld`).toBeTruthy();
    }
  });

  it("keeps the known credential tables in the secret list", () => {
    // Named explicitly so removing one is a deliberate act with a red test,
    // not a quiet edit to a map.
    for (const table of [
      "mfa_recovery_codes",
      "security_pin",
      "user_encryption_keys",
      "webauthn_credentials",
      "webauthn_challenges",
    ]) {
      expect(SECRET_TABLES[table], `${table} dropped out of the secret list`).toBeTruthy();
    }
  });

  it("exports no table from a restricted domain", () => {
    // Messaging, moderation and verification are personal but withheld in bulk.
    // A table from one of them appearing in the plan would silently defeat that.
    const restricted = DATA_DOMAINS.filter((d) => portabilityFor(d.id)?.dataClass === "restricted");
    const leaked = restricted.flatMap((d) => d.tables.filter((t) => t in OWNER_COLUMN));
    expect(leaked, `Restricted-domain tables in the export plan: ${leaked.join(", ")}`).toHaveLength(0);
  });
});
