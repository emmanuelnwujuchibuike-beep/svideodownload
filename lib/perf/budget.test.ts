import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildExists, formatKb, routeWeights } from "./budget";

/** The JS chunks the landing page actually loads, straight from the manifest. */
function landingChunks(): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(".next", "app-build-manifest.json"), "utf8")) as {
      pages?: Record<string, string[]>;
    };
    return (manifest.pages?.["/(marketing)/page"] ?? []).filter((f) => f.endsWith(".js"));
  } catch {
    return [];
  }
}

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

/**
 * Everything. Catches a shared chunk ballooning across the whole app.
 *
 * ── 340 → 341 kB (2026-08-17) ──────────────────────────────────────────────
 * The feed's gesture-correctness + keyboard-accessibility pass (owner spec:
 * "Keyboard users can still open media" — Enter/Space now open the media on
 * FeedImage/FeedVideo/MediaCarousel, none of which had any keyboard path at
 * all before) put `/(app)/home/page` 187 BYTES over 340 kB gzipped —
 * confirmed via `routeWeights()` directly, not guessed from the rounded
 * `formatKb` display. That is real, new, load-bearing code (the keyboard
 * handlers), not slack, and the accessibility requirement is not optional —
 * so the ceiling moves the 187 bytes it needs rather than the fix getting
 * cut to fit. Bumped to 341 kB, not further: `/home` now measures ~340.18 kB,
 * so there is deliberately almost no slack left on this route either.
 */
const GLOBAL_CEILING = 341 * 1024;

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
 *
 * 302 → 303 kB (2026-08-03): the owner-requested Telegram platform added a 12th
 * brand (lib/platforms) and TWO more brand-icon SVGs to the hero + paste-box
 * "Supported platforms" strips (SiTelegram + SiYoutube, both explicitly asked for),
 * plus the announcement / top-of-page ad banner wiring in the marketing layout.
 * Each legitimately lives on the landing; everything that COULD be deferred already
 * is — the language-picker table, the analytics collector, and both banners are all
 * dynamic-imported off first-load. This is the measured 302.8 kB, the smallest step
 * over. Holding the line here.
 *
 * 303 → 304 kB (2026-08-04): a CORRECTNESS fix, not a feature. `saveToDevice` and
 * `saveBlob` built a filename with `…slice(0, 120)`, which cuts from the end — so
 * any long title lost its extension ("….jpg" → "….jp") and iOS offered the file as
 * an untyped "File" that could not be saved to Photos. The owner hit it on an X
 * image; short titles were unaffected, which is why it looked random. The fix is
 * `lib/download-filename.ts` (reserve the extension, then truncate the base), which
 * the landing's Downloader pulls in through `client-download`. It is ~0.5 kB and
 * cannot be deferred: it is on the synchronous path of every completed download.
 * Nothing else moved — the wallpaper/interstitial work this shipped alongside is
 * entirely off the landing. This is the smallest step over the measured 303.x kB.
 *
 * 304 → 305 kB (2026-08-04, later): batch "Save all". On iOS every finished file
 * needs its own tap, so selecting eight snaps of a Snapchat story meant eight
 * taps and eight share sheets — the owner's "it only downloads one, I have to
 * mark them one after the other". `navigator.share` accepts an ARRAY, so the
 * whole batch now goes into one sheet (`saveFilesToDevice`), plus an IndexedDB
 * fallback so a batch no longer loses its earliest files to the in-memory cap.
 *
 * It CANNOT be code-split: iOS only permits `navigator.share` while the tap's
 * transient activation is alive, and awaiting a dynamic import first is exactly
 * what destroys it — the feature would break on the platform it exists for. So
 * it stays on the synchronous path, at ~0.6 kB.
 *
 * Second bump today, both correctness fixes on the download path (the other was
 * the lost file extension). Worth naming: the landing has no headroom left, and
 * the next FEATURE that wants a byte here should take one out first.
 *
 * ── 305 → 275 kB (2026-08-09): the first CUT this file has ever recorded ──────
 * The owner tightened the cold-entry target from 2s to under 1.6s, and a ceiling
 * that only ever ratchets upward cannot deliver that. Measured after the change:
 * 265.1 kB, down from 305.0 kB.
 *
 * The whole 40 kB was ONE static import. `features/downloads/floating-progress`
 * used framer-motion for a slide-up spring, `Downloader` imports it statically,
 * and `Downloader` is on the landing — so every first-time visitor downloaded
 * the entire animation library, 13% of the budget, to animate a card that only
 * exists after they have already started a download. It is a CSS `animate-in`
 * now and framer-motion is off the marketing tree completely (asserted below).
 *
 * The ceiling drops to 275 kB rather than to the measured 265 kB on purpose:
 * pinning a gate to the exact current number makes it fire on rounding and
 * teaches people to raise it. ~10 kB of working room, ~30 kB of the win locked
 * in permanently. The rule is unchanged and now has somewhere to be spent from:
 * a feature that wants bytes here still has to find them.
 */
const ENTRY_CEILING = 275 * 1024;

const ENTRY_ROUTES = [
  "/(marketing)/page",
  "/(marketing)/[downloader]/page",
  "/(marketing)/academy/page",
  "/(marketing)/trust/page",
  "/(marketing)/learn/page",
];

/**
 * ── /downloads — the SIGNED-IN front door, guarded (owner, 2026-08-10) ───────
 *
 * "Make the download page use the same budget and performance and LCP as the
 *  landing page, in case of users who have an account."
 *
 * The intent is right and it was completely unguarded: this is where an account
 * holder starts every session, and nothing stopped it drifting. It had ZERO
 * dynamic imports — every panel, including several screens below the fold, sat
 * in the first load. Splitting HistoryPanel, WallpaperGallery and DownloadsRail
 * took it from 312.7 kB to 295.1 kB.
 *
 * ── Why it is NOT held to the 275 kB entry ceiling ──────────────────────────
 *
 * Byte-parity with the landing is not reachable without an accessibility
 * regression, and that is a trade worth refusing rather than quietly making.
 *
 * The gap is almost exactly one chunk: framer-motion, 39.3 kB, which arrives via
 * `MotionConfig` in the (app) layout. Two ways to remove it and both are worse
 * than the bytes:
 *
 *  • DEFER IT — `MotionConfig` wraps the entire app subtree, so swapping the
 *    wrapper's element type when the chunk lands REMOUNTS every page beneath it,
 *    discarding the state of whatever the user was doing.
 *  • DROP IT — it is the single point that makes every framer transition in the
 *    app tree collapse under `prefers-reduced-motion`, with no per-component
 *    opt-in. Removing it silently reintroduces motion for people who asked the
 *    OS for none, on the same day this project took Lighthouse accessibility
 *    from 87 to 100.
 *
 * The real fix is to move `MotionConfig` down to only the subtrees that animate
 * (feed, reels, messages) so static routes never pay for it. That is a change
 * across every app route and belongs in its own pass, not smuggled into a
 * download-page commit.
 *
 * So this gets its OWN ceiling with the same RATCHET rule as everything else in
 * this file: 300 kB, just above the measured 295.1, and it only ever moves down.
 * The page is now held to the landing's *discipline* — which is what the ask was
 * really about — even though it cannot yet be held to the landing's number.
 */
const APP_ENTRY_CEILING = 300 * 1024;
const APP_ENTRY_ROUTES = ["/(app)/downloads/page"];

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

  it("keeps the signed-in download page under its own ceiling", () => {
    const weights = new Map(routeWeights().map((r) => [r.route, r.bytes]));

    const over = APP_ENTRY_ROUTES.filter((route) => {
      const bytes = weights.get(route);
      return bytes !== undefined && bytes > APP_ENTRY_CEILING;
    }).map((route) => `${formatKb(weights.get(route)!).padStart(8)}  ${route}`);

    expect(
      over,
      `Signed-in entry routes over ${formatKb(APP_ENTRY_CEILING)}:\n  ${over.join("\n  ")}\n\n` +
        `/downloads is where an account holder starts every session. Same ratchet ` +
        `rule as the landing: find the bytes, do not raise the ceiling. See the ` +
        `note above APP_ENTRY_CEILING for why this is 300 and not 275.`,
    ).toHaveLength(0);
  });

  it("keeps framer-motion off the landing page entirely", () => {
    /*
     * The byte ceiling above would catch this eventually, but only as an opaque
     * "you are 40 kB over" on whichever commit happens to cross the line —
     * which is how it stayed on the landing unnoticed for weeks in the first
     * place. Naming the library makes the failure self-explanatory and points
     * at the fix.
     *
     * A single static import anywhere in the landing's module graph is enough
     * to pull the whole library in, and the import that did it
     * (`floating-progress`, four files deep under `Downloader`) was nowhere
     * near the landing in the source tree. Asserting on the BUILD ARTIFACT is
     * the only check that can see that; reading imports cannot.
     */
    const chunks = landingChunks();
    expect(chunks.length, "landing chunks not found in the build manifest").toBeGreaterThan(0);

    const offenders = chunks.filter((f) =>
      /framer-motion|AnimatePresence|useMotionValue/.test(readFileSync(join(".next", f), "utf8")),
    );

    expect(
      offenders,
      `framer-motion is back on the landing, in:\n  ${offenders.join("\n  ")}\n\n` +
        `It is ~39 kB gzipped — 13% of the cold-entry budget — on a page that ` +
        `animates entirely in CSS. Find the static import (it will be several ` +
        `files deep) and either convert it to CSS or next/dynamic it.`,
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
