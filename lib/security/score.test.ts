import { describe, expect, it } from "vitest";

import { BAND_LABEL, nextSecurityStep, securityScore, type SecurityInputs } from "@/lib/security/score";

const bare: SecurityInputs = {
  mfaEnabled: false,
  passkeyCount: 0,
  recoveryCodesRemaining: 0,
  pinSet: false,
  trustedDeviceCount: 0,
  emailConfirmed: false,
  stepUpOnNewDevice: false,
};

const input = (over: Partial<SecurityInputs> = {}): SecurityInputs => ({ ...bare, ...over });

const secured: SecurityInputs = {
  mfaEnabled: true,
  passkeyCount: 2,
  recoveryCodesRemaining: 8,
  pinSet: true,
  trustedDeviceCount: 2,
  emailConfirmed: true,
  stepUpOnNewDevice: true,
};

describe("securityScore", () => {
  it("stays within 0–100", () => {
    expect(securityScore(bare).score).toBeGreaterThanOrEqual(0);
    expect(securityScore(secured).score).toBe(100);
  });

  it("calls a bare account at risk", () => {
    const result = securityScore(bare);
    expect(result.band).toBe("at-risk");
    expect(BAND_LABEL[result.band]).toBe("Needs attention");
  });

  it("calls a fully secured account strong", () => {
    expect(securityScore(secured).band).toBe("strong");
  });

  // The rule that stops the score being theatre.
  it("never reaches the top band while a critical gap is open", () => {
    // Everything EXCEPT a second factor — a respectable total, a real hole.
    const result = securityScore(
      input({ emailConfirmed: true, pinSet: true, trustedDeviceCount: 3, stepUpOnNewDevice: true }),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.band).not.toBe("strong");
    expect(result.band).not.toBe("good");
  });

  it("treats a missing second factor as critical only while there is none", () => {
    const noMfa = securityScore(input({ passkeyCount: 1, emailConfirmed: true, recoveryCodesRemaining: 5 }));
    expect(noMfa.gaps.find((g) => g.key === "mfa")?.severity).toBe("recommended");

    const nothing = securityScore(input({ emailConfirmed: true }));
    expect(nothing.gaps.find((g) => g.key === "mfa")?.severity).toBe("critical");
  });

  // Being locked out of your own account is a security failure too.
  it("treats missing recovery codes as critical once a second factor exists", () => {
    const withFactor = securityScore(input({ mfaEnabled: true, emailConfirmed: true }));
    expect(withFactor.gaps.find((g) => g.key === "recovery")?.severity).toBe("critical");

    const withoutFactor = securityScore(input({ emailConfirmed: true }));
    expect(withoutFactor.gaps.find((g) => g.key === "recovery")?.severity).toBe("recommended");
  });

  it("scores an unconfirmed email as a critical gap", () => {
    expect(securityScore(secured).gaps).toHaveLength(0);
    const unconfirmed = securityScore({ ...secured, emailConfirmed: false });
    expect(unconfirmed.gaps.find((g) => g.key === "email")?.severity).toBe("critical");
  });

  it("orders gaps critical-first, then by value", () => {
    const gaps = securityScore(bare).gaps;
    const firstRecommended = gaps.findIndex((g) => g.severity === "recommended");
    const lastCritical = gaps.map((g) => g.severity).lastIndexOf("critical");
    if (firstRecommended !== -1) expect(lastCritical).toBeLessThan(firstRecommended);
    const criticals = gaps.filter((g) => g.severity === "critical");
    for (let i = 1; i < criticals.length; i += 1) {
      expect(criticals[i]!.points).toBeLessThanOrEqual(criticals[i - 1]!.points);
    }
  });

  it("every gap says what it actually prevents, and where to go", () => {
    for (const g of securityScore(bare).gaps) {
      expect(g.why.length, g.key).toBeGreaterThan(30);
      expect(g.href.startsWith("/"), g.key).toBe(true);
      expect(g.title.length).toBeGreaterThan(5);
    }
  });

  it("credits what is already in place", () => {
    const result = securityScore(secured);
    expect(result.strengths).toContain("Two-factor authentication is on");
    expect(result.strengths).toContain("2 passkeys registered");
    expect(result.strengths).toContain("Email confirmed");
  });

  it("uses the singular for one passkey", () => {
    expect(securityScore(input({ passkeyCount: 1 })).strengths).toContain("1 passkey registered");
  });

  it("improves monotonically as protections are added", () => {
    const steps = [
      bare,
      input({ emailConfirmed: true }),
      input({ emailConfirmed: true, mfaEnabled: true }),
      input({ emailConfirmed: true, mfaEnabled: true, recoveryCodesRemaining: 10 }),
      input({ emailConfirmed: true, mfaEnabled: true, recoveryCodesRemaining: 10, passkeyCount: 1 }),
    ].map((i) => securityScore(i).score);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]).toBeGreaterThan(steps[i - 1]!);
  });

  // No points for anything that does not change an attacker's job.
  it("awards nothing for engagement-style signals", () => {
    const onlyDevices = securityScore(input({ trustedDeviceCount: 50 }));
    expect(onlyDevices.score).toBeLessThanOrEqual(10);
    expect(onlyDevices.band).toBe("at-risk");
  });
});

describe("nextSecurityStep", () => {
  it("points at the most urgent gap", () => {
    expect(nextSecurityStep(securityScore(bare))?.severity).toBe("critical");
  });

  it("returns null when there is nothing left to fix", () => {
    expect(nextSecurityStep(securityScore(secured))).toBeNull();
  });
});
