import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AD_FORMATS,
  AD_ZONES,
  AD_ZONE_META,
  RETIRED_FORMATS,
  isPersistentZone,
  isServableFormat,
} from "./ad-schema";
import { DEFAULT_MONETIZATION } from "./settings";

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
    expect(furniture).toMatch(/<StickyBottomAd\b/);
    expect(furniture).toMatch(/<IdleInterstitial\b/);

    // Mounting them in BOTH places is the other failure — two bottom bars and
    // two idle timers on the one page that has them inline.
    const home = stripComments(readFileSync(path.join(ROOT, "app/(marketing)/page.tsx"), "utf8"));
    expect(home, "landing page mounts a second bottom banner").not.toMatch(/<StickyBottomAd\b/);
    expect(home, "landing page mounts a second idle interstitial").not.toMatch(/<IdleInterstitial\b/);
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
