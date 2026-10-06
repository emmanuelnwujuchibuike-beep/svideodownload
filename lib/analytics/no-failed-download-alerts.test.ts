import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-06: "Stop admin from receiving failed and cancelled
 * notification, I think it also take part in the Vercel consumption."
 * Measured that afternoon: 340 download-outcome pushes in 3 hours — each a
 * Vercel invocation plus four database writes. The download rows go to
 * Postgres directly (lib/analytics/ingest.ts), so the dashboard keeps them.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("failed and cancelled downloads do not alert the admin", () => {
  it("the browser does not call Vercel for them", () => {
    expect(read("lib/analytics/client.ts")).toContain('if (status === "failed" || status === "cancelled") return false;');
  });

  it("the collector ignores them even from an older cached client", () => {
    const route = read("app/api/analytics/collect/route.ts");
    expect(route).not.toContain("notifyAdminsOfDownloadOutcome");
  });

  it("abandoned downloads are still swept, but nobody is pushed (owner, 2026-10-06)", () => {
    const cron = read("app/api/cron/abandoned-downloads/route.ts");
    expect(cron).not.toContain("notifyAdminsOfDownloadOutcome");
    expect(cron).toContain('.update({ status: "timed_out" })');
  });
});
