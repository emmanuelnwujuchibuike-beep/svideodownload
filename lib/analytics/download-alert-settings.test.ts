import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeDownloadAlerts } from "./download-alert-settings";

/*
  The milestone-email threshold, made adjustable (owner, 2026-08-24: "i can
  turn off, extend or shorten the download threshold email alert from 100 to
  any number or turn it off").

  It used to be `ALERT_DOWNLOAD_EVERY`, a build-time env var — so a change meant
  a redeploy, and an empty value was silently falsy. Same trap that left every
  cron 403ing (lib/cron/auth.ts).
*/
describe("normalizeDownloadAlerts", () => {
  it("🔴 defaults `enabled` to TRUE when the field is absent", () => {
    /*
      THE IMPORTANT ONE. A row written before `enabled` existed, or any partial
      write, must not read as "off" — that would silently stop every milestone
      email with nothing on screen to explain it. Absent means on.
    */
    expect(normalizeDownloadAlerts({ every: 250 }).enabled).toBe(true);
    expect(normalizeDownloadAlerts({}).enabled).toBe(true);
    expect(normalizeDownloadAlerts(null).enabled).toBe(true);
  });

  it("keeps an explicit off", () => {
    expect(normalizeDownloadAlerts({ every: 100, enabled: false }).enabled).toBe(false);
  });

  it("accepts any whole number the owner types", () => {
    for (const n of [1, 10, 25, 500, 100_000]) {
      expect(normalizeDownloadAlerts({ every: n, enabled: true }).every).toBe(n);
    }
  });

  it("never yields a value that would divide by zero or loop", () => {
    // `Math.floor(count / every)` is meaningless for 0 or a negative.
    for (const bad of [0, -5, 0.4, NaN, Infinity, "200", null, undefined]) {
      const { every } = normalizeDownloadAlerts({ every: bad as number, enabled: true });
      expect(Number.isInteger(every), `every=${String(bad)} → ${every}`).toBe(true);
      expect(every).toBeGreaterThanOrEqual(1);
    }
  });

  it("floors a fractional value rather than rejecting it", () => {
    expect(normalizeDownloadAlerts({ every: 150.9, enabled: true }).every).toBe(150);
  });
});

/*
  ── The wallpaper retry bug ────────────────────────────────────────────────
  An admin alert read: "generic · image · That doesn't look like a valid URL."

  A wallpaper downloads from `/api/wallpaper?id=…` — a RELATIVE path. That is a
  fine fetch target and not something /api/download can accept: `new URL()`
  throws on it, so `sourceUrlSchema` rejects it outright. The first download
  worked because the task carried `directUrl`; history never stored that field,
  so every RETRY sent the relative path to the pipeline instead — which would
  have run yt-dlp on our own image endpoint even if it had validated.
*/
describe("download retry keeps its direct target", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("the manager never sends a same-origin path to /api/download", () => {
    const manager = src("features/downloads/manager.ts");
    expect(manager).toContain("function fetchTarget");
    // The relative-path guard, and the fetch going through it.
    expect(manager).toContain("test(t.url)) return t.url");
    expect(manager).toContain("fetch(fetchTarget(task)");
  });

  it("persists directUrl on every history write", () => {
    const manager = src("features/downloads/manager.ts");
    // completed, failed and cancelled all reach history and all can be retried.
    expect(manager.match(/directUrl: task\.directUrl \?\? null/g)?.length).toBe(3);
  });

  it.each([
    "features/history/use-gated-retry.ts",
    "features/history/history-panel.tsx",
    "features/history/media-gallery.tsx",
  ])("%s passes directUrl through on retry", (file) => {
    expect(src(file)).toMatch(/directUrl: (record|item)\.directUrl \?\? undefined/);
  });

  it("DownloadRecord can carry it", () => {
    expect(src("types/index.ts")).toMatch(/directUrl\?: string \| null;\n  createdAt: number;/);
  });
});
