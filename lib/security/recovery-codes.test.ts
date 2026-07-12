import { beforeAll, describe, expect, it } from "vitest";

import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes";

const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

describe("generateRecoveryCodes", () => {
  it("generates 10 codes by default, each shaped XXXX-XXXX-XXXX from the no-ambiguous-character alphabet", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(CODE_RE);
  });

  it("generates the requested count", () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it("never produces a duplicate within one batch (high-entropy sanity check)", () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
  });
});

describe("hashRecoveryCode", () => {
  beforeAll(() => {
    process.env.RECOVERY_CODE_PEPPER = "test-pepper-do-not-use-in-prod";
  });

  it("is deterministic for the same code", () => {
    expect(hashRecoveryCode("ABCD-EFGH-JKLM")).toBe(hashRecoveryCode("ABCD-EFGH-JKLM"));
  });

  it("is case- and whitespace-insensitive (matches how a user might paste/retype it)", () => {
    expect(hashRecoveryCode("abcd-efgh-jklm")).toBe(hashRecoveryCode("  ABCD-EFGH-JKLM  "));
  });

  it("produces different hashes for different codes", () => {
    expect(hashRecoveryCode("ABCD-EFGH-JKLM")).not.toBe(hashRecoveryCode("ZZZZ-EFGH-JKLM"));
  });

  it("throws if the pepper isn't configured, rather than silently hashing unsalted", () => {
    const prev = process.env.RECOVERY_CODE_PEPPER;
    delete process.env.RECOVERY_CODE_PEPPER;
    try {
      expect(() => hashRecoveryCode("ABCD-EFGH-JKLM")).toThrow();
    } finally {
      process.env.RECOVERY_CODE_PEPPER = prev;
    }
  });
});
