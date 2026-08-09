import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "The hero section turns pure black when I click download, especially a
 * multiple download" (owner, 2026-08-09).
 *
 * ── The chain ────────────────────────────────────────────────────────────────
 * 1. `FullscreenInterstitial` renders `fixed inset-0 bg-black` — fully OPAQUE,
 *    covering the page — and reveals it when `shown === true`.
 * 2. `shown = open && hasAd === true`, and `hasAd` is whatever `AdSlot` passed
 *    to `onResolved`.
 * 3. `AdSlot` reported `Boolean(found)`: whether an ad ROW EXISTS.
 *
 * But `AdSlot` renders NOTHING for several rows that exist — a `pop` creative is
 * `display: contents` by design, a `video` row is played by a different
 * component, and any row missing its format's required fields falls through to
 * `return null`. Each of those made the slot answer "yes" and then paint
 * nothing: an opaque black screen over the whole page, with only the X to
 * escape.
 *
 * A BATCH is what surfaced it — the interstitial fires on every 3rd completed
 * download, and several completions in a row walk the counter onto a multiple
 * of three.
 *
 * ── Why a source test ────────────────────────────────────────────────────────
 * The failure is a DISAGREEMENT between two places in one file: what
 * `rendersVisibly` promises and what the render actually returns. Nothing type-
 * checks that relationship, and it produces no error — just a black rectangle.
 * These assertions keep the two in step.
 */
const SLOT = readFileSync(join(process.cwd(), "features/monetization/ad-slot.tsx"), "utf8");
const SHELL = readFileSync(
  join(process.cwd(), "features/monetization/fullscreen-interstitial.tsx"),
  "utf8",
);

describe("AdSlot reports visibility, not mere existence", () => {
  it("no longer answers with Boolean(found)", () => {
    // The exact expression that caused the black screen.
    expect(SLOT, "onResolved is back to reporting row existence").not.toMatch(
      /onResolved\?\.\(Boolean\(found\)\)/,
    );
  });

  it("answers through the visibility predicate", () => {
    expect(SLOT).toMatch(/onResolved\?\.\(rendersVisibly\(found\)\)/);
    expect(SLOT).toMatch(/function rendersVisibly/);
  });

  it("treats the two invisible formats as invisible", () => {
    /*
      `pop` paints no box (display: contents) and `video` is rendered by the
      placement that owns a player. Both are REAL ads — they must still run —
      but neither is something a wrapper can frame.
    */
    const fn = SLOT.slice(SLOT.indexOf("function rendersVisibly"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/case "pop":/);
    expect(body).toMatch(/case "video":/);
    // Both fall to the same `return false`.
    expect(body).toMatch(/case "pop":\s*\n\s*case "video":\s*\n\s*return false;/);
  });

  it("requires each visible format's own fields", () => {
    const fn = SLOT.slice(SLOT.indexOf("function rendersVisibly"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // A native ad with no link, or a display ad with no script, renders null.
    expect(body).toMatch(/case "native":\s*\n\s*return !!ad\.targetUrl;/);
    expect(body).toMatch(/case "display":\s*\n\s*return !!ad\.scriptCode;/);
  });

  it("still lets AdSense answer for itself, later", () => {
    // A configured unit can return no creative and collapse; only the unit
    // knows, and it reports through onFill.
    expect(SLOT).toMatch(/found\?\.format !== "adsense"/);
    expect(SLOT).toMatch(/onFill=\{/);
  });

  it("keeps a case for every format the render branches on", () => {
    // Drift guard: a new format added to the render without a case here would
    // fall to `default: return false` and silently never show. That is the safe
    // direction, but it should be a deliberate choice, not an oversight.
    const rendered = [...SLOT.matchAll(/ad\.format === "(\w+)"/g)].map((m) => m[1]);
    const predicate = SLOT.slice(SLOT.indexOf("function rendersVisibly"));
    for (const format of new Set(rendered)) {
      expect(predicate, `rendersVisibly has no case for "${format}"`).toMatch(
        new RegExp(`case "${format}":`),
      );
    }
  });
});

describe("the interstitial only unveils itself for a real creative", () => {
  it("is opaque, so an empty one is a black screen", () => {
    // Documents WHY the above matters: this is not a translucent scrim.
    expect(SHELL).toMatch(/fixed inset-0 z-\[60\] bg-black/);
  });

  it("gates every visible child on `shown`", () => {
    // Belt and braces: even if a slot lies, nothing paints until `shown`.
    expect(SHELL).toMatch(/shown \? "opacity-100" : "pointer-events-none opacity-0"/);
    expect(SHELL).toMatch(/!shown && "hidden"/);
  });

  it("still offers an escape while the countdown runs", () => {
    // A black screen with no way out is the worst version of this bug.
    expect(SHELL).toMatch(/Skip in \{remaining\}s/);
    expect(SHELL).toMatch(/aria-label="Close advertisement"/);
  });
});
