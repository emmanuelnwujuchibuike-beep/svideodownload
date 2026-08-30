import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AD_FORMATS,
  AD_ZONES,
  AD_ZONE_META,

  EXOCLICK_ZONES,
  zoneSurface,
  RETIRED_FORMATS,
  isPersistentZone,
  isServableFormat,
} from "./ad-schema";
import {
  DEFAULT_MONETIZATION,
  exoClickZoneEnabled,
  normalizeExoClickZones,
  resolveExoClickZoneId,
} from "./settings";

/**
 * Ad slots — the empty-box class of bug.
 *
 * ── What was reported ─────────────────────────────────────────────────────────
 *
 * "Some shows an empty white space." `AdSlot` returns `null` when a zone has no
 * ad, which is correct and is also invisible to its PARENT. Several parents draw
 * chrome around it — a "Sponsored" label, a border, a close button, a reserved
 * height — and rendered that chrome unconditionally. With the zone unseeded the
 * result is a decorated box wrapped around nothing.
 *
 * Measured against the live API: 7 of the 8 declared zones return `{"ad":null}`,
 * so this was not an edge case, it was the normal state of the product.
 *
 * ── Why this is a source scan and not a render test ───────────────────────────
 *
 * The bug is structural — "does this wrapper know whether the slot found
 * anything" — and it is a property of how the component is written. There is no
 * DOM test environment configured here, and a render test would in any case
 * assert the symptom on one component rather than the rule across all of them.
 */

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "features"];

/**
 * Strip comments before scanning.
 *
 * Not optional, and not a tidy-up. The first version of this file scanned raw
 * source, and the very doc comment explaining why `empty:hidden` could not be
 * used in `FetchedAd` contained the literal string `empty:hidden` — so the
 * guard read the prose, concluded the component could collapse, and passed.
 * Deliberately reintroducing the bug did not turn it red.
 *
 * A guard that matches its own documentation is decorative. `reality-ledger.ts`
 * strips comments for the same reason.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.tsx$/.test(entry) && !entry.includes(".test.") ? [rel] : [];
  });
}

const FILES = SCAN_DIRS.flatMap(walk);

/** Files that render an `<AdSlot`, excluding the slot's own definition. */
const CALL_SITES = FILES.filter((file) => {
  if (file.endsWith(path.join("features", "monetization", "ad-slot.tsx"))) return false;
  return /<AdSlot\b/.test(readFileSync(path.join(ROOT, file), "utf8"));
});

describe("Ad slots — call-site inventory", () => {
  it("finds the call sites at all", () => {
    // Guards the suite: if AdSlot is renamed or moved, everything below would
    // pass vacuously while the rule stopped being enforced anywhere.
    expect(CALL_SITES.length).toBeGreaterThan(2);
  });

  it("only requests zones that are declared", () => {
    /*
     * A typo'd zone is not a crash — the API returns `{"ad":null}` and the slot
     * renders nothing, which is indistinguishable from an unseeded zone. It
     * would look exactly like the symptom being investigated here.
     */
    const declared = new Set<string>(AD_ZONES);
    const bad: string[] = [];
    for (const file of CALL_SITES) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      for (const match of src.matchAll(/<AdSlot[^>]*?zone="([^"]+)"/gs)) {
        if (!declared.has(match[1]!)) bad.push(`${file} → ${match[1]}`);
      }
    }
    expect(bad, `AdSlot call sites using an undeclared zone:\n  ${bad.join("\n  ")}`).toHaveLength(0);
  });
});

describe("Ad slots — formats", () => {
  it("refuses to serve any format not in the registry", () => {
    for (const format of RETIRED_FORMATS) {
      expect(isServableFormat(format), `${format} is still servable`).toBe(false);
    }
  });

  it("fails closed on an unknown format", () => {
    // A typo in a hand-edited row must render nothing, not fall through to the
    // display branch and inject whatever is in script_code.
    for (const bogus of ["", "banner", "POP", "displayy", null, undefined]) {
      expect(isServableFormat(bogus)).toBe(false);
    }
  });

  it("keeps the pop format gated behind a switch that defaults OFF", () => {
    /*
     * `pop` was removed on the instruction to drop click-hijacking formats and
     * restored on the later instruction to bring it back. Both were deliberate.
     *
     * What this pins is the part that must NOT be lost in either direction: a
     * pop unit must never serve by default. The original switch defaulted ON,
     * which is how a pop-under came to be running unnoticed and produced "I
     * click a button and it redirects me to an ad site".
     */
    expect((AD_FORMATS as readonly string[]).includes("pop")).toBe(true);
    expect(DEFAULT_MONETIZATION.popunder, "popunder must default to off").toBe(false);

    const route = stripComments(readFileSync(path.join(ROOT, "app/api/ads/route.ts"), "utf8"));
    expect(route, "the pop format is not gated server-side").toMatch(
      /!settings\.popunder && a\.format === "pop"/,
    );
  });

  it("keeps ExoClick gated behind a master switch that defaults OFF", () => {
    /*
     * ExoClick's inventory skews adult and this site has already been refused by
     * AdSense three times. Wiring the zones must never be the same act as
     * switching the network on — an operator has to seed the ids, look at the
     * admin, and still be serving nothing until they deliberately opt in.
     */
    expect((AD_FORMATS as readonly string[]).includes("exoclick")).toBe(true);
    expect(DEFAULT_MONETIZATION.exoclick, "exoclick must default to off").toBe(false);

    const route = stripComments(readFileSync(path.join(ROOT, "app/api/ads/route.ts"), "utf8"));
    expect(route, "the exoclick format is not gated server-side").toMatch(
      /a\.format === "exoclick" && !exoClickZoneEnabled\(settings, zone\)/,
    );
  });

  it("🔴 gates each ExoClick zone SEPARATELY, so AdSense pages can be cleared alone", () => {
    /*
     * Owner, 2026-08-30: "so i can turn off landing page where adsense are, and
     * leave for only reels page when adsense accepts."
     *
     * A single network switch would force all-or-nothing and the two networks
     * could never occupy the site at once on different pages. What is pinned
     * here is the arrangement that request describes, end to end.
     */
    const on = { exoclick: true, exoclickZones: {} };
    // Master on, nothing opted out — every zone serves.
    for (const zone of EXOCLICK_ZONES) {
      expect(exoClickZoneEnabled(on, zone), `${zone} should serve`).toBe(true);
    }

    // The owner's exact configuration: every AdSense-facing page off, Reels on.
    const reelsOnly = {
      exoclick: true,
      exoclickZones: Object.fromEntries(
        EXOCLICK_ZONES.filter((z) => zoneSurface(z) === "marketing").map((z) => [z, false]),
      ),
    };
    expect(exoClickZoneEnabled(reelsOnly, "reels_interstitial")).toBe(true);
    for (const zone of EXOCLICK_ZONES) {
      if (zoneSurface(zone) === "marketing") {
        expect(exoClickZoneEnabled(reelsOnly, zone), `${zone} must be off`).toBe(false);
      }
    }

    // The master stays a real kill switch, not a suggestion: with it off, an
    // explicitly-enabled zone still serves nothing.
    expect(
      exoClickZoneEnabled({ exoclick: false, exoclickZones: { reels_interstitial: true } }, "reels_interstitial"),
    ).toBe(false);
  });

  it("🔴 groups the paste-box zone as a page AdSense reviews", () => {
    /*
     * The landing page renders the shared `Downloader`, so `downloader_above_fetch`
     * appears ON the landing as well as on the generated downloader pages.
     * Grouping it as app-side would let someone switch "the landing" off in the
     * admin and still be serving ExoClick above the paste box on it — the exact
     * false sense of safety this split exists to prevent.
     */
    expect(zoneSurface("downloader_above_fetch")).toBe("marketing");
    // Reels is the only surface behind sign-in, and therefore the only one no
    // AdSense reviewer can reach.
    const appZones = EXOCLICK_ZONES.filter((z) => zoneSurface(z) === "app");
    expect(appZones).toEqual(["reels_interstitial"]);
  });

  it("🔴 serves an ExoClick row on ANY zone, not just the five it shipped with", () => {
    /*
     * THE REGRESSION. `exoClickZoneEnabled` used to return false for any zone
     * outside `EXOCLICK_ZONES`, so an ExoClick row placed anywhere else served
     * nothing — silently, with the row still reading "Live" in the admin and
     * the master switch on.
     *
     * Reported within a day of shipping: a row on `result_top` (the one zone
     * whose label contains the word "fetch") rendered nothing, and no surface
     * anywhere said why. The admin offered a combination `AdSlot` would happily
     * render and the server then dropped.
     */
    const on = { exoclick: true, exoclickZones: {} };
    for (const zone of AD_ZONES) {
      expect(exoClickZoneEnabled(on, zone), `${zone} should serve with the master on`).toBe(true);
    }
    // …and a non-native zone is still individually switchable, or the
    // AdSense-safety split would have a hole exactly where the bug was.
    expect(exoClickZoneEnabled({ exoclick: true, exoclickZones: { result_top: false } }, "result_top")).toBe(false);
    expect(normalizeExoClickZones({ result_top: false })).toEqual({ result_top: false });
  });

  it("🔴 an explicit ad row always beats the shared Zone ID", () => {
    /*
     * Owner: "put a way i can select to use one ad zone id link for all ad slots
     * or not."
     *
     * Precedence only goes one way, and that is the safety property: turning
     * shared mode on must never silently repoint a placement someone
     * deliberately configured with its own id.
     */
    const shared = { exoclickSharedZoneId: "111111" };
    expect(resolveExoClickZoneId(shared, "reels_interstitial", "999999")).toBe("999999");
    expect(resolveExoClickZoneId(shared, "reels_interstitial", null)).toBe("111111");
    // Blank/whitespace on the row is not a configuration — fall through.
    expect(resolveExoClickZoneId(shared, "reels_interstitial", "   ")).toBe("111111");
  });

  it("🔴 the shared ID reaches only the purpose-built 9:16 placements", () => {
    /*
     * "All ad slots" means all the ExoClick ones. Applying it to every zone in
     * the registry would drop a vertical video into the bottom banner and the
     * blog sidebar — placements shaped for a leaderboard.
     */
    const shared = { exoclickSharedZoneId: "111111" };
    for (const zone of EXOCLICK_ZONES) {
      expect(resolveExoClickZoneId(shared, zone, null), `${zone} should take the shared id`).toBe("111111");
    }
    for (const zone of ["bottom_banner", "sidebar", "top_banner", "feed_inline"]) {
      expect(resolveExoClickZoneId(shared, zone, null), `${zone} must not`).toBeNull();
    }
    // …but an explicit row still works anywhere, which is how `result_top` runs.
    expect(resolveExoClickZoneId(shared, "result_top", "6015286")).toBe("6015286");
  });

  it("shared mode is OFF by default", () => {
    expect(DEFAULT_MONETIZATION.exoclickSharedZoneId).toBe("");
    expect(resolveExoClickZoneId({ exoclickSharedZoneId: "" }, "reels_interstitial", null)).toBeNull();
  });

  it("🔴 classifies EVERY zone as marketing or app", () => {
    /*
     * `ZONE_SURFACE` is what tells an operator whether a Google reviewer can
     * reach a placement, and it drives the per-page switch grouping. A zone
     * missing from it would render an unlabelled switch and, worse, would leave
     * the "is this an AdSense-visible page" question silently unanswered on the
     * one control built to answer it.
     */
    for (const zone of AD_ZONES) {
      expect(zoneSurface(zone), `${zone} has no surface classification`).toMatch(/^(marketing|app)$/);
    }
    // Only the two social-feed placements sit behind sign-in. Everything else
    // is reachable by a reviewer, and must be classified as such.
    const appZones = AD_ZONES.filter((z) => zoneSurface(z) === "app");
    expect([...appZones].sort()).toEqual(["feed_inline", "reels_interstitial"]);
  });

  it("🔴 a non-boolean stored value can never turn a disabled zone back on", () => {
    // `"false"` is truthy. Coercing instead of dropping would silently re-enable
    // a placement the operator switched off — on the one setting whose whole
    // purpose is keeping a network away from an AdSense review.
    const dirty = normalizeExoClickZones({
      reels_interstitial: "false",
      landing_section_break: false,
      not_a_zone: true,
    });
    expect(dirty).toEqual({ landing_section_break: false });
    expect(normalizeExoClickZones(null)).toEqual({});
    expect(normalizeExoClickZones([1, 2])).toEqual({});
  });

  it("every ExoClick zone is a real zone with admin metadata", () => {
    // The per-page switches render from this list and label themselves from
    // AD_ZONE_META, so a drifted id would be an unlabelled switch that gates
    // nothing.
    for (const zone of EXOCLICK_ZONES) {
      expect((AD_ZONES as readonly string[]).includes(zone), `${zone} is not a declared zone`).toBe(true);
      expect(AD_ZONE_META[zone], `${zone} has no admin metadata`).toBeTruthy();
    }
  });

  it("runs a pop script in the page, never inside the display iframe", () => {
    // A sandboxed frame cannot bind the window-opening handler these creatives
    // rely on, so a pop pasted into a `display` placement renders a blank box
    // that earns nothing — the failure the admin now warns about.
    const src = stripComments(
      readFileSync(path.join(ROOT, "features/monetization/ad-slot.tsx"), "utf8"),
    );
    expect(src).toMatch(/injectAdMarkup/);
    expect(src).toMatch(/format === "pop"/);
  });

  it("still refuses to let a display frame navigate the top window", () => {
    /*
     * Independent of the pop decision. `allow-top-navigation-by-user-activation`
     * is what let a script inside the display iframe redirect the whole page on
     * any click — the "blank slot that takes me to a different site". Restoring
     * the pop FORMAT must not quietly restore that too.
     */
    const src = stripComments(
      readFileSync(path.join(ROOT, "features/monetization/ad-slot.tsx"), "utf8"),
    );
    expect(src).not.toMatch(/allow-top-navigation/);
  });
});

describe("Ad slots — zone registry", () => {
  it("keeps the runtime list and the AdZone type in agreement", () => {
    /*
     * `AD_ZONES` drives the admin dropdown and the validator; `AdZone` is what
     * every call site is typed against. When they drift, a placement validates
     * and saves in the admin and then renders nowhere — which is invisible from
     * either side on its own.
     *
     * Checked by source rather than by type because a type cannot be enumerated
     * at runtime, and the failure is exactly a type/runtime mismatch.
     */
    const typeSrc = readFileSync(path.join(ROOT, "lib/monetization/types.ts"), "utf8");
    const union = typeSrc.slice(typeSrc.indexOf("export type AdZone"));
    const declared = [...union.slice(0, union.indexOf(";")).matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1]!,
    );

    expect([...declared].sort()).toEqual([...AD_ZONES].sort());
  });

  it("describes every zone for the admin", () => {
    // The dropdown shows these. An operator picking "result_top" cannot be
    // expected to know it means the strip above a fetched result.
    for (const zone of AD_ZONES) {
      const meta = AD_ZONE_META[zone];
      expect(meta, `${zone} has no admin metadata`).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(3);
      expect(meta.description.length).toBeGreaterThan(20);
    }
  });

  it("never offers a dismiss control on furniture", () => {
    // The bottom banner, the under-download unit and the homepage strip are
    // layout, not interruptions. An X on them is what makes an ad read as
    // something to get rid of rather than part of the page.
    for (const zone of ["bottom_banner", "under_download", "homepage_top", "reward_video"]) {
      expect(isPersistentZone(zone), `${zone} should be persistent`).toBe(true);
    }
    // …and the ones the visitor genuinely needs to get past are not furniture.
    for (const zone of ["idle_interstitial", "download_complete", "download_result_page"]) {
      expect(isPersistentZone(zone), `${zone} must stay dismissible`).toBe(false);
    }
  });
});

describe("Ad slots — one zone list, not four", () => {
  it("never re-lists the zones anywhere outside the registry", () => {
    /*
     * Three separate copies of this list existed, and every one of them was out
     * of date the moment a placement was added. Each failed silently and
     * differently:
     *
     *  - `/api/ads` rejected the zone, so the unit could never fill no matter
     *    what was seeded.
     *  - `/api/track` rejected the beacon. `navigator.sendBeacon` never surfaces
     *    a response, so impressions and clicks were dropped with no symptom at
     *    all, and the dashboard showed a confident zero.
     *  - `lib/monetization/stats.ts` iterated its copy to build the per-zone
     *    table, so a live placement was ABSENT from the report rather than shown
     *    as zero — unfalsifiable from the reader's side.
     *
     * The rule is therefore structural: any file that names two or more zone ids
     * as string literals is building a second registry.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.endsWith(path.join("lib", "monetization", "ad-schema.ts"))) continue;
      const src = stripComments(readFileSync(path.join(ROOT, file), "utf8"));
      const hits = new Set(
        [...src.matchAll(/["']([a-z_]+)["']/g)]
          .map((m) => m[1]!)
          .filter((v) => (AD_ZONES as readonly string[]).includes(v)),
      );
      if (hits.size >= 3) offenders.push(`${file} (${[...hits].join(", ")})`);
    }
    expect(
      offenders,
      `Files re-listing the zone registry:\n  ${offenders.join("\n  ")}\n\n` +
        `Import AD_ZONES from lib/monetization/ad-schema instead.`,
    ).toHaveLength(0);
  });
});

describe("Ad slots — no decorated empty boxes", () => {
  it("gives every call site a way to collapse when the zone is empty", () => {
    /*
     * Two acceptable mechanisms, and a call site must use one:
     *
     *  - `onResolved` — the slot tells the parent whether it found an ad, so
     *    the parent can withhold its chrome. Required whenever the wrapper has
     *    SIBLINGS of the slot (a label, a close button), because then the
     *    wrapper is never childless.
     *  - `empty:hidden` — the CSS route. Only valid when the slot is the
     *    wrapper's only child, which is why it worked on the landing page and
     *    could not be copied to `FetchedAd`.
     *
     * A bare `<AdSlot />` with no wrapper is also fine: nothing renders, so
     * nothing can be empty. That is why this checks for chrome first.
     */
    const offenders: string[] = [];

    for (const file of CALL_SITES) {
      const src = stripComments(readFileSync(path.join(ROOT, file), "utf8"));

      /*
        Three mechanisms are acceptable, and a call site must use one:

         1. `onResolved` — the slot reports whether it found an ad and the
            parent withholds its chrome. Required whenever the chrome has
            SIBLINGS of the slot, because then the wrapper is never childless.
         2. `empty:hidden` — the CSS route. Only valid when the slot is the
            wrapper's only child.
         3. The component fetches the zone ITSELF and returns null when it is
            empty. `ResultAd` does this because it needs the row's `skippable`
            and `skip_after_seconds` anyway, so asking the slot a second time
            would be redundant. It is exactly as safe: nothing renders.

        (3) was missing when this rule was first written, and the guard
        correctly flagged a component that was already correct — a false
        positive is how a check like this earns a reputation for crying wolf
        and gets deleted, so it is worth recognising the pattern properly.
      */
      const collapses =
        /onResolved=/.test(src) ||
        /empty:hidden/.test(src) ||
        /if \(!ad[^)]*\)\s*return null/.test(src);
      if (collapses) continue;

      // Chrome = a label a reader would read as "an ad goes here", or a
      // reserved height. Either is visible with no ad behind it.
      const hasChrome = /Sponsored|min-h-\[|aria-label="Close ad"/.test(src);
      if (hasChrome) offenders.push(file);
    }

    expect(
      offenders,
      `Ad wrappers that draw chrome but cannot collapse when the zone is empty:\n  ${offenders.join("\n  ")}\n\n` +
        `Pass onResolved to AdSlot and withhold the chrome until it reports an ad.`,
    ).toHaveLength(0);
  });

  it("would actually fail if a call site lost its collapse mechanism", () => {
    /*
     * Proves the rule above can go red. Without this, the check that matters
     * most in this file is the one nobody has ever seen fail — and it silently
     * did not work at all until comment-stripping was added.
     */
    const src = stripComments(
      readFileSync(path.join(ROOT, "features/monetization/fetched-ad.tsx"), "utf8"),
    );
    const broken = src.replace(/onResolved=\{[^}]*\}/g, "");
    expect(/onResolved=/.test(broken), "fixture did not remove the mechanism").toBe(false);
    expect(/empty:hidden/.test(broken), "empty:hidden survived comment stripping").toBe(false);
    // …and it still has the chrome that makes the absence a problem.
    expect(/Sponsored|min-h-\[|aria-label="Close ad"/.test(broken)).toBe(true);
  });

  it("routes the landing page slot through a collapsing surface", () => {
    /*
     * Was an `empty:hidden` assertion. That utility was the CSS-only fix for the
     * band of dead space this section was reported for, and it has been
     * superseded by `AdSurface`, which renders nothing at all until the slot
     * confirms an ad — a stronger guarantee, since it also collapses the label
     * and the card that `empty:hidden` could never see past.
     *
     * The requirement is unchanged: this page must not be able to render a
     * wrapper around an empty zone.
     */
    const src = stripComments(readFileSync(path.join(ROOT, "app/(marketing)/page.tsx"), "utf8"));
    expect(src, "landing page renders a raw AdSlot again").not.toMatch(/<AdSlot\b/);
    expect(src).toMatch(/<AdSurface\b/);
  });

  it("puts the site-wide furniture in the layout, not on individual pages", () => {
    /*
     * The bottom banner and the idle interstitial must cover every page in the
     * marketing group — ~150 routes once the generated downloader pages are
     * counted. Mounting them per page guarantees drift: a route added later
     * gets a header, a footer and no banner, and the missing thing is an
     * absence nobody notices.
     *
     * They now live in `DeferredAdFurniture`, which the layout mounts after the
     * page is idle so it stays out of the landing page's first hydration task.
     * The requirement is unchanged — the layout carries the furniture for every
     * page — so the check follows it into that component.
     */
    const layout = stripComments(
      readFileSync(path.join(ROOT, "app/(marketing)/layout.tsx"), "utf8"),
    );
    expect(layout).toMatch(/<DeferredAdFurniture\b/);

    const furniture = stripComments(
      readFileSync(path.join(ROOT, "features/monetization/deferred-ad-furniture.tsx"), "utf8"),
    );
    expect(furniture).toMatch(/<TopBannerAd\b/);
    expect(furniture).toMatch(/<IdleInterstitial\b/);

    // Mounting them in BOTH places is the other failure — two banners and
    // two idle timers on the one page that has them inline.
    const home = stripComments(readFileSync(path.join(ROOT, "app/(marketing)/page.tsx"), "utf8"));
    expect(home, "landing page mounts a second top banner").not.toMatch(/<TopBannerAd\b/);
    expect(home, "landing page mounts a second idle interstitial").not.toMatch(/<IdleInterstitial\b/);
  });

  it("puts the download-history slot on every surface that shows the history", () => {
    /*
     * The regression (owner, 2026-08-09: "I no longer see ad even after I turn
     * on the ad").
     *
     * `download_history_top` and `download_history_bottom` were seeded and were
     * rendered by /library and /downloads — but NOT by /history, the History nav
     * destination, which is the page an operator would assume those two zones
     * are named after. The only furniture it carried came from the marketing
     * layout, whose zones were both empty. Verified against the live /api/ads
     * before fixing: the two seeded zones had no slot, and the two slots had no
     * ad.
     *
     * Nothing structural stopped this — the panel is a shared component and the
     * placement is per page, so a fourth surface rendering the history would
     * silently repeat it. The rule is therefore: show the history, show the
     * history ad.
     */
    const panel = "<" + "HistoryPanel";
    const ad = "<" + "DownloadHistoryAd";
    const surfaces = FILES.filter((file) =>
      stripComments(readFileSync(path.join(ROOT, file), "utf8")).includes(panel),
    );

    // Guards a vacuous pass: if the panel is renamed, this must not silently
    // stop checking anything.
    expect(surfaces.length, "found no surface rendering the download history").toBeGreaterThanOrEqual(3);

    const missing = surfaces.filter(
      (file) => !stripComments(readFileSync(path.join(ROOT, file), "utf8")).includes(ad),
    );
    expect(
      missing,
      `Surfaces that show the download history but not its ad zones:\n  ${missing.join("\n  ")}`,
    ).toHaveLength(0);
  });

  it("puts the under-download slot in the shared Downloader, not per page", () => {
    // One edit covering the home page and all ~148 generated downloader pages,
    // and inherited automatically by any SEO page added later.
    const src = stripComments(
      readFileSync(path.join(ROOT, "features/downloader/downloader.tsx"), "utf8"),
    );
    expect(src).toMatch(/zone="under_download"/);
  });

  it("starts FetchedAd hidden rather than visible", () => {
    /*
     * The specific regression. `useState(true)` for "is there an ad" renders the
     * card before the answer arrives, which IS the empty box — the state has to
     * start unresolved.
     */
    const src = readFileSync(path.join(ROOT, "features/monetization/fetched-ad.tsx"), "utf8");
    expect(src).toMatch(/useState<boolean \| null>\(null\)/);
    expect(src).toMatch(/hasAd === true/);
  });
});
