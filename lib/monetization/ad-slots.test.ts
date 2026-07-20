import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AD_ZONES } from "./ad-schema";

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
      const collapses = /onResolved=/.test(src) || /empty:hidden/.test(src);
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

  it("keeps the landing page wrapper collapsible", () => {
    // This one is load-bearing and CSS-only: the wrapper has padding, so
    // without `empty:hidden` it renders a band of dead space between two
    // sections. It has regressed into that state once already.
    const src = readFileSync(path.join(ROOT, "app/(marketing)/page.tsx"), "utf8");
    expect(src).toMatch(/empty:hidden/);
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
