import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { linkWarning } from "./link-warning";
import { assessFailures, assessSignIn, cleanCountry, FAILED_CHECKS_AT } from "./suspicious";

const H = 3_600_000;

// Feature 20 Part 7 — Suspicious Activity Engine: explainable rules, each with its facts
describe("assessSignIn", () => {
  const now = Date.UTC(2026, 9, 12, 12);
  it("two countries within 6 hours → named, both countries", () => {
    const s = assessSignIn({ country: "GB", at: now }, [{ country: "NG", at: now - 2 * H }]);
    expect(s?.reason).toBe("two_countries");
    expect(s?.body).toContain("GB");
    expect(s?.body).toContain("NG");
  });
  it("a country not seen in 30 days → new_country", () => {
    expect(assessSignIn({ country: "US", at: now }, [{ country: "NG", at: now - 3 * 24 * H }])?.reason).toBe("new_country");
  });
  it("the usual country, or no history, or no country → nothing", () => {
    expect(assessSignIn({ country: "NG", at: now }, [{ country: "NG", at: now - H }])).toBeNull();
    expect(assessSignIn({ country: "NG", at: now }, [])).toBeNull();
    expect(assessSignIn({ country: null, at: now }, [{ country: "GB", at: now - H }])).toBeNull();
  });
  it("a sign-in older than 30 days does not count as history", () => {
    expect(assessSignIn({ country: "US", at: now }, [{ country: "NG", at: now - 40 * 24 * H }])).toBeNull();
  });
});

describe("assessFailures", () => {
  const now = Date.now();
  it(`${FAILED_CHECKS_AT} failed checks in an hour → alert; fewer, or older → nothing`, () => {
    expect(assessFailures(Array.from({ length: FAILED_CHECKS_AT }, (_, i) => now - i * 60_000), now)?.reason).toBe("failed_checks");
    expect(assessFailures(Array.from({ length: FAILED_CHECKS_AT - 1 }, () => now), now)).toBeNull();
    expect(assessFailures(Array.from({ length: 9 }, () => now - 2 * H), now)).toBeNull();
  });
});

describe("cleanCountry", () => {
  it("only a real two-letter code", () => {
    expect(cleanCountry("ng")).toBe("NG");
    expect(cleanCountry("XX")).toBeNull();
    expect(cleanCountry("T1")).toBeNull();
    expect(cleanCountry("")).toBeNull();
    expect(cleanCountry("Nigeria")).toBeNull();
  });
});

// Phishing protection
describe("linkWarning", () => {
  it("frenzsave.com and its subdomains are trusted", () => {
    expect(linkWarning("https://frenzsave.com/p/1")).toBeNull();
    expect(linkWarning("https://media.frenzsave.com/x.jpg")).toBeNull();
    expect(linkWarning("https://www.tiktok.com/@x")).toBeNull();
  });
  it("look-alikes are flagged", () => {
    expect(linkWarning("https://frenzsave-login.com")).toBe("impersonates");
    expect(linkWarning("https://frenz-save.co/verify")).toBe("impersonates");
    expect(linkWarning("https://frenzsave.com.verify-account.io")).toBe("impersonates");
    expect(linkWarning("https://fr3nzsave.com".replace("3", "e"))).toBeNull();
  });
  it("disguised, bare-IP and credential-hiding links are flagged", () => {
    expect(linkWarning("https://xn--frnzsave-z2a.com")).toBe("disguised");
    expect(linkWarning("http://185.22.10.4/login")).toBe("bare-ip");
    expect(linkWarning("https://frenzsave.com@evil.io/")).toBe("credentials");
  });
  it("every link in a message goes through it", () => {
    expect(readFileSync("components/social/rich-text.tsx", "utf8")).toContain("const warn = linkWarning(token);");
  });
});

// Notification Authenticity
describe("security alerts carry a reference a member can verify", () => {
  it("every security notification gets one, stored and shown", () => {
    const s = readFileSync("lib/notifications/smart-delivery.ts", "utf8");
    expect(s).toContain('const ref = type && type.startsWith("security_") ? securityRef() : null;');
    expect(s).toContain("...(ref ? { ref } : {})");
    expect(readFileSync("lib/auth/device-check.ts", "utf8")).toContain("const ref = securityRef();");
  });
  it("verification reads only the member's own security rows", () => {
    const r = readFileSync("app/api/security/verify-alert/route.ts", "utf8");
    expect(r).toContain('.eq("user_id", user.id)');
    expect(r).toContain('.like("type", "security_%")');
    expect(r).toContain("trackLimiter.limit(");
  });
});
