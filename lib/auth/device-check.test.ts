import { describe, expect, it } from "vitest";

import { shouldAlertForNewDevice, type SessionRow } from "./device-check";

function row(created_at: string, user_agent: string | null): SessionRow {
  return { id: created_at, created_at, user_agent };
}

describe("shouldAlertForNewDevice", () => {
  it("never alerts on a single session (first-ever sign-in, nothing to compare against)", () => {
    expect(shouldAlertForNewDevice([row("2026-07-10T10:00:00Z", "Chrome/Windows")], "Chrome/Windows")).toBe(false);
  });

  it("never alerts with zero sessions on record", () => {
    expect(shouldAlertForNewDevice([], "Chrome/Windows")).toBe(false);
  });

  it("alerts for a genuinely new user-agent when there's real history to compare against", () => {
    const rows = [row("2026-07-01T10:00:00Z", "Safari/iOS"), row("2026-07-10T10:00:00Z", "Chrome/Windows")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows")).toBe(true);
  });

  it("does not alert for a user-agent seen before, even if it isn't the most recent row", () => {
    const rows = [
      row("2026-07-01T10:00:00Z", "Chrome/Windows"),
      row("2026-07-05T10:00:00Z", "Safari/iOS"),
      row("2026-07-10T10:00:00Z", "Chrome/Windows"),
    ];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows")).toBe(false);
  });

  it("excludes the newest row from its own comparison set", () => {
    const rows = [row("2026-07-01T10:00:00Z", "Safari/iOS"), row("2026-07-10T10:00:00Z", "Safari/iOS")];
    // Matches the OLDER Safari/iOS row, so still correctly "not new".
    expect(shouldAlertForNewDevice(rows, "Safari/iOS")).toBe(false);
  });

  it("never alerts when there's no user-agent to check", () => {
    const rows = [row("x", "a"), row("y", "b")];
    expect(shouldAlertForNewDevice(rows, null)).toBe(false);
  });

  it("works regardless of input row order", () => {
    const rows = [row("2026-07-10T10:00:00Z", "Chrome/Windows"), row("2026-07-01T10:00:00Z", "Safari/iOS")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows")).toBe(true);
  });
});
