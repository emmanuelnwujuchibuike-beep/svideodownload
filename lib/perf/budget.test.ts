import { describe, expect, it } from "vitest";

import { buildExists, formatKb, routeWeights } from "./budget";

/**
 * Route weight budget — the 2-second rule, enforced mechanically.
 *
 * ── These are RATCHETS, not aspirations ───────────────────────────────────────
 *
 * The ceilings below sit just above today's heaviest routes. That is deliberate:
 * a budget set to where we WISH we were fails on day one, gets marked skip, and
 * protects nothing. A budget set just above where we ARE catches the next
 * regression on the commit that causes it — which is the only moment it is cheap
 * to fix.
 *
 * When a route gets lighter, LOWER the number. That is the whole mechanism: it
 * only ever moves down, so the site cannot silently drift heavier over time.
 * Raising one should require the same justification as any other regression.
 *
 * ── Why this is skipped without a build ───────────────────────────────────────
 *
 * There is no manifest to measure on a fresh clone or in a unit-test-only CI
 * step. Skipping is right: a test that fails because an artifact is absent
 * teaches people to ignore it. Where it matters — a pipeline that builds — it
 * runs.
 */

/** Everything. Catches a shared chunk ballooning across the whole app. */
const GLOBAL_CEILING = 340 * 1024;

/**
 * First-visit entry routes, held tighter.
 *
 * These are where the 2-second budget actually applies: a cold visitor arriving
 * from search or a shared link, on a slow connection, with an empty cache. The
 * signed-in app pages are reached after that first paint has already happened.
 *
 * 300 → 301 kB (2026-07-22): the owner-requested global "Your downloads" header
 * entry (DownloadsEntry) is permanent chrome on every marketing page and costs
 * ~0.35 kB. The 5 GB guest gate that shipped alongside it was pushed OFF the
 * landing entirely — dynamic-imported QuotaGate + a fully lazy, on-tap usage
 * check — so this bump buys the header button, not the feature behind it.
 *
 * 301 → 302 kB (2026-07-22, later): the download interstitial the owner asked for
 * fires on "every 3rd download" and "every 3rd history watch", so its trigger
 * counters live in the shared download manager and player store — both of which
 * the landing's Downloader already imports. Adding those exports shifted the
 * landing's shared-chunk composition by a few hundred bytes; the interstitial UI,
 * the review player and the ad furniture themselves are all code-split off
 * first-load (ReviewPlayerMount, DeferredAdFurniture, the dynamic interstitial).
 * This is the smallest step over the measured 301.3 kB. Holding the line here.
 */
const ENTRY_CEILING = 302 * 1024;

const ENTRY_ROUTES = [
  "/(marketing)/page",
  "/(marketing)/[downloader]/page",
  "/(marketing)/academy/page",
  "/(marketing)/trust/page",
  "/(marketing)/learn/page",
];

describe.skipIf(!buildExists())("route weight budget", () => {
  it("keeps every route under the global ceiling", () => {
    const over = routeWeights()
      .filter((r) => r.bytes > GLOBAL_CEILING)
      .map((r) => `${formatKb(r.bytes).padStart(8)}  ${r.route}`);

    expect(
      over,
      `Routes over ${formatKb(GLOBAL_CEILING)} of gzipped JS:\n  ${over.join("\n  ")}\n\n` +
        `If this is a genuine, justified increase, raise GLOBAL_CEILING and say why in the commit.`,
    ).toHaveLength(0);
  });

  it("keeps cold-entry routes under the tighter ceiling", () => {
    const weights = new Map(routeWeights().map((r) => [r.route, r.bytes]));

    const over = ENTRY_ROUTES.filter((route) => {
      const bytes = weights.get(route);
      return bytes !== undefined && bytes > ENTRY_CEILING;
    }).map((route) => `${formatKb(weights.get(route)!).padStart(8)}  ${route}`);

    expect(
      over,
      `Cold-entry routes over ${formatKb(ENTRY_CEILING)}:\n  ${over.join("\n  ")}\n\n` +
        `These are the pages the 2-second budget exists for — a first visit from ` +
        `search, slow connection, empty cache.`,
    ).toHaveLength(0);
  });

  it("measures the routes it claims to", () => {
    /*
     * Guard against the budget silently measuring nothing. If a route key changes
     * — a route group is renamed, say — the filters above would quietly match zero
     * routes and both tests would pass while checking nothing at all.
     */
    const weights = new Map(routeWeights().map((r) => [r.route, r.bytes]));
    const missing = ENTRY_ROUTES.filter((r) => !weights.has(r));

    expect(
      missing,
      `Entry routes absent from the build manifest — the budget is not measuring them:\n  ${missing.join("\n  ")}`,
    ).toHaveLength(0);
  });
});
