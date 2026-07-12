import { describe, expect, it } from "vitest";

import { RECENT_LOGIN_WINDOW_MS, shouldAlertForNewDevice, type SessionRow } from "./device-check";

function row(created_at: string, user_agent: string | null): SessionRow {
  return { id: created_at, created_at, user_agent };
}

// Fixed "now" so the recent-login window is deterministic in every test.
const NOW = +new Date("2026-07-10T10:05:00Z");
const JUST_LOGGED_IN = "2026-07-10T10:00:00Z"; // 5 min ago — inside the window
const DAYS_AGO = "2026-07-01T10:00:00Z"; // far outside the window

describe("shouldAlertForNewDevice", () => {
  it("never alerts on a single session (first-ever sign-in, nothing to compare against)", () => {
    expect(shouldAlertForNewDevice([row(JUST_LOGGED_IN, "Chrome/Windows")], "Chrome/Windows", NOW)).toBe(false);
  });

  it("never alerts with zero sessions on record", () => {
    expect(shouldAlertForNewDevice([], "Chrome/Windows", NOW)).toBe(false);
  });

  it("alerts for a genuinely new user-agent right after a login, with real history to compare against", () => {
    const rows = [row(DAYS_AGO, "Safari/iOS"), row(JUST_LOGGED_IN, "Chrome/Windows")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(true);
  });

  it("does not alert for a user-agent seen before the login", () => {
    const rows = [
      row("2026-06-20T10:00:00Z", "Chrome/Windows"),
      row(DAYS_AGO, "Safari/iOS"),
      row(JUST_LOGGED_IN, "Chrome/Windows"),
    ];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(false);
  });

  it("NEVER alerts on a plain app re-entry (no session created recently) — the owner's 'every time I enter the app' bug", () => {
    // Two devices, both sessions old. Opening the app on the device that did
    // NOT create the most recent session used to alert on every entry.
    const rows = [row("2026-06-20T10:00:00Z", "Safari/iOS"), row(DAYS_AGO, "Chrome/Windows")];
    expect(shouldAlertForNewDevice(rows, "Safari/iOS", NOW)).toBe(false);
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(false);
    // Even a UA matching NEITHER old session stays silent without a login.
    expect(shouldAlertForNewDevice(rows, "Firefox/Linux", NOW)).toBe(false);
  });

  it("never alerts when every session is brand new (account creation burst)", () => {
    const rows = [row(JUST_LOGGED_IN, "Chrome/Windows"), row("2026-07-10T10:01:00Z", "Chrome/Windows")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(false);
  });

  it("treats the freshly-created session's own UA as new-device evidence, not familiarity", () => {
    // The just-created session naturally carries the new device's UA — only
    // OLDER sessions count as "seen before".
    const rows = [row(DAYS_AGO, "Safari/iOS"), row(JUST_LOGGED_IN, "Safari/iOS")];
    expect(shouldAlertForNewDevice(rows, "Safari/iOS", NOW)).toBe(false); // matches the OLD row → familiar
  });

  it("never alerts when there's no user-agent to check", () => {
    const rows = [row(DAYS_AGO, "a"), row(JUST_LOGGED_IN, "b")];
    expect(shouldAlertForNewDevice(rows, null, NOW)).toBe(false);
  });

  it("works regardless of input row order", () => {
    const rows = [row(JUST_LOGGED_IN, "Chrome/Windows"), row(DAYS_AGO, "Safari/iOS")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(true);
  });

  it("window boundary: a session exactly at the edge still counts as recent", () => {
    const edge = new Date(NOW - RECENT_LOGIN_WINDOW_MS).toISOString();
    const rows = [row(DAYS_AGO, "Safari/iOS"), row(edge, "Chrome/Windows")];
    expect(shouldAlertForNewDevice(rows, "Chrome/Windows", NOW)).toBe(true);
  });
});
