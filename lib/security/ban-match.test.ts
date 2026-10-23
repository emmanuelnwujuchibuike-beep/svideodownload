import { describe, expect, it } from "vitest";

import { matchBan, type BanIndex } from "./ban-match";

/** The ban rule (0267) — every identifier, and the one combination that must NOT ban on its own. */
const index = (): BanIndex => ({
  users: new Set(["u-banned"]),
  devices: new Set(["dev-banned"]),
  fingerprints: new Set(["fp-banned"]),
  ipBrowsers: new Set(["102.89.1.1|Mozilla/5.0 (iPhone) Safari"]),
});

describe("a banned request", () => {
  it("matches on the account, the device id or the fingerprint — each alone", () => {
    expect(matchBan(index(), { userId: "u-banned" })).toBe(true);
    expect(matchBan(index(), { deviceId: "dev-banned" })).toBe(true);
    expect(matchBan(index(), { fingerprint: "fp-banned" })).toBe(true);
  });

  it("a guest who cleared their storage is still caught by the fingerprint", () => {
    expect(matchBan(index(), { deviceId: "a-fresh-id", fingerprint: "fp-banned", ip: "1.1.1.1" })).toBe(true);
  });

  it("matches the network address together with the same browser", () => {
    expect(matchBan(index(), { ip: "102.89.1.1", userAgent: "Mozilla/5.0 (iPhone) Safari" })).toBe(true);
  });

  it("🔴 teeth: the network address ALONE never bans — a stranger on the same carrier address is let through", () => {
    expect(matchBan(index(), { ip: "102.89.1.1", userAgent: "Mozilla/5.0 (Android) Chrome" })).toBe(false);
    expect(matchBan(index(), { ip: "102.89.1.1" })).toBe(false);
  });

  it("nobody else is banned", () => {
    expect(matchBan(index(), { userId: "u-ok", deviceId: "dev-ok", fingerprint: "fp-ok", ip: "9.9.9.9", userAgent: "x" })).toBe(false);
    expect(matchBan(index(), {})).toBe(false);
  });
});
