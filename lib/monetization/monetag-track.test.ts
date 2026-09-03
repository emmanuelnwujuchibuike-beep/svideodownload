import { describe, expect, it } from "vitest";

import { MONETAG_AD_TYPES, MONETAG_PLACEMENTS } from "./monetag";
import {
  MONETAG_SLOT_LABELS,
  MONETAG_TRACK_SLOTS,
  isMonetagSlot,
  monetagFormatSlot,
  monetagMomentSlot,
} from "./monetag-track";

/**
 * The one thing these must guarantee is that a format or moment added to the
 * registry is REPORTABLE without anyone remembering to update a second list.
 * `/api/track` validates against this set and the beacon is `sendBeacon`, which
 * surfaces no response — so a slot missing from here is dropped silently and
 * looks exactly like a recorded one. That is the failure mode the route's own
 * header warns about, reached from a different direction.
 */

describe("Monetag track slots", () => {
  it("covers every registered format and every registered moment", () => {
    for (const t of MONETAG_AD_TYPES) {
      expect(MONETAG_TRACK_SLOTS).toContain(monetagFormatSlot(t.id));
    }
    for (const p of MONETAG_PLACEMENTS) {
      expect(MONETAG_TRACK_SLOTS).toContain(monetagMomentSlot(p.id));
    }
    expect(MONETAG_TRACK_SLOTS).toHaveLength(MONETAG_AD_TYPES.length + MONETAG_PLACEMENTS.length);
  });

  it("never collides a format id with a moment id", () => {
    // `download_complete` is a moment and could plausibly become a format name;
    // the two prefixes are what keep them apart in one flat slot namespace.
    expect(new Set(MONETAG_TRACK_SLOTS).size).toBe(MONETAG_TRACK_SLOTS.length);
    expect(monetagFormatSlot("x")).not.toBe(monetagMomentSlot("x"));
  });

  it("recognises its own slots and nothing else", () => {
    for (const slot of MONETAG_TRACK_SLOTS) expect(isMonetagSlot(slot)).toBe(true);
    // The other families that share this endpoint must not be swept up: the
    // recording branch keys on this predicate, so a false positive would credit
    // an ExoClick or Hilltop placement to Monetag.
    for (const other of ["hilltop_landing", "sticky", "bottomnav", "interstitial", "historyfeed"]) {
      expect(isMonetagSlot(other)).toBe(false);
    }
  });

  it("labels every slot — an unlabelled row prints its raw id at an operator", () => {
    for (const slot of MONETAG_TRACK_SLOTS) {
      expect(MONETAG_SLOT_LABELS[slot]).toBeTruthy();
      expect(MONETAG_SLOT_LABELS[slot]).toMatch(/^Monetag — /);
      expect(MONETAG_SLOT_LABELS[slot]).not.toContain("_");
    }
  });
});
