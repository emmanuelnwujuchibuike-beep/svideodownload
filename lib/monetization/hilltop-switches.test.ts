import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HILLTOP,
  HILLTOP_PLACEMENTS,
  HILLTOP_PLACEMENT_BY_ZONE,
  hilltopZoneSource,
  isHilltopPlacementOffForZone,
  normalizeHilltop,
  type HilltopConfig,
} from "./hilltop-config";

const ROOT = path.join(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 A SWITCH THAT NOTHING READS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-02: "hiltop settings switch dont take effect, when i turn off
 * idle interstilla it didnt turn off."
 *
 * Nine placement toggles were rendered in the admin panel; three of them were
 * consulted by any code at all. The other six wrote a perfectly correct value to
 * the settings row and were then read by nothing — production answered
 * `placements: {"idle": false}` while `/api/ads/exoclick?zone=idle_interstitial`
 * was still handing out a Hilltop creative.
 *
 * It is the worst shape a bug can take on a control surface: the UI shows the
 * operator's choice back to them, the write succeeds, the save confirmation
 * appears, and the behaviour is unchanged. There is nothing to see and nothing
 * to debug from the outside — which is why it stood for a day and had to be
 * found by probing the live endpoint.
 *
 * These tests exist because the failure is INVISIBLE and therefore repeatable.
 * The last guard is the one that matters most: it fails when a new placement is
 * added to the panel without being wired to anything, so the next one cannot
 * ship dead.
 */

const on: HilltopConfig = normalizeHilltop({ ...DEFAULT_HILLTOP, enabled: true });

describe("hilltop placement switches actually gate their zones", () => {
  it("🔴 turning the idle placement off stops the idle zone serving", () => {
    // Before: `idle_interstitial` defaults to the VAST player.
    expect(hilltopZoneSource(on, "idle_interstitial")).toBe("vast");

    const off = normalizeHilltop({ ...on, placements: { idle: false } });
    expect(hilltopZoneSource(off, "idle_interstitial")).toBe("off");
  });

  it("🔴 the placement switch outranks a per-zone source override", () => {
    /*
      The operator has made two statements and they disagree: "this zone plays
      VAST" and "do not run this placement". The second is the more specific
      instruction and the one they made most recently on the panel, so a picker
      left on `vast` must not resurrect a switched-off placement.
    */
    const off = normalizeHilltop({
      ...on,
      placements: { idle: false },
      zoneSource: { idle_interstitial: "vast" },
    });
    expect(hilltopZoneSource(off, "idle_interstitial")).toBe("off");
  });

  it("switches every mapped zone, not just idle", () => {
    for (const [zone, placement] of Object.entries(HILLTOP_PLACEMENT_BY_ZONE)) {
      const off = normalizeHilltop({ ...on, placements: { [placement]: false } });
      expect(hilltopZoneSource(off, zone), `${placement} should switch ${zone} off`).toBe("off");
    }
  });

  it("one placement switch does not silence a zone it does not own", () => {
    /*
      `download` is labelled "Download complete — VAST video". The BATCH
      completion is a separate moment with its own timer and its own controls, so
      it must survive — folding it in would be a control doing something nobody
      asked it to.
    */
    const off = normalizeHilltop({ ...on, placements: { download: false } });
    expect(hilltopZoneSource(off, "download_complete")).toBe("off");
    expect(hilltopZoneSource(off, "batch_download_complete")).toBe("vast");
  });

  it("leaves everything serving when no placement is switched off", () => {
    expect(hilltopZoneSource(on, "download_complete")).toBe("vast");
    expect(hilltopZoneSource(on, "history_story_ad")).toBe("vast");
  });

  it("🔴 serves the VAST on COMPLETION moments and never on a gate", () => {
    /*
      Owner, 2026-09-02: "the vast shouldnt be as reward, only as download
      complete on all download, remove all the reward hiltop vast."

      A wallpaper tap used to play this creative twice — once as the reward gate
      (`wallpaper_reward`) and again on completion. The gate moments are `off`
      now, and this is the guard that keeps them that way: pointing any of them
      back at `vast` re-creates the duplicate ad.
    */
    for (const zone of ["download_complete", "batch_download_complete"]) {
      expect(hilltopZoneSource(on, zone), zone).toBe("vast");
    }
    for (const zone of ["wallpaper_reward", "batch_download_gate", "download_preparing"]) {
      expect(hilltopZoneSource(on, zone), zone).toBe("off");
    }
  });

  it("the master switch still wins over everything", () => {
    const master = normalizeHilltop({ ...DEFAULT_HILLTOP, enabled: false });
    expect(hilltopZoneSource(master, "idle_interstitial")).toBe("off");
  });

  it("🔴 a `banner` override is honoured, not silently discarded", () => {
    /*
      The old resolver tested for "off" | "slider" | "vast" and fell through to
      the defaults for anything else, so the fourth button in the admin's picker
      did nothing at all: a zone defaulting to `vast` and set to `banner` read
      back as `vast` for ever, while the UI kept showing `banner` as selected
      because it renders the STORED value rather than the resolved one.
    */
    const banner = normalizeHilltop({ ...on, zoneSource: { idle_interstitial: "banner" } });
    expect(hilltopZoneSource(banner, "idle_interstitial")).toBe("banner");
  });

  it("every source the picker offers survives a round trip", () => {
    for (const source of ["off", "banner", "slider", "vast"] as const) {
      const cfg = normalizeHilltop({ ...on, zoneSource: { download_complete: source } });
      expect(hilltopZoneSource(cfg, "download_complete"), source).toBe(source);
    }
  });
});

describe("switched-off is distinguishable from not-served", () => {
  it("🔴 off means off, and never 'show the banner instead'", () => {
    /*
      `IdleInterstitial` renders a BANNER interstitial and stands down only when
      the VAST player owns the moment. Given a plain `off` it would read "the
      video is not taking this, so I will" — so switching the idle placement off
      would have swapped a video ad for a banner ad rather than removing it, and
      the owner would have reported the same thing again.
    */
    const off = normalizeHilltop({ ...on, placements: { idle: false } });
    expect(isHilltopPlacementOffForZone(off, "idle_interstitial")).toBe(true);
    expect(isHilltopPlacementOffForZone(on, "idle_interstitial")).toBe(false);
  });

  it("a zone Hilltop simply does not serve is not 'switched off'", () => {
    expect(hilltopZoneSource(on, "reels_vertical")).toBe("off");
    expect(isHilltopPlacementOffForZone(on, "reels_vertical")).toBe(false);
  });

  const idleSrc = read("features/monetization/idle-interstitial.tsx");
  it("the idle component reads that distinction", () => {
    expect(idleSrc).toContain("isHilltopPlacementOffForZone");
    expect(idleSrc).toMatch(/placementOff/);
  });
});

describe("🔴 no placement toggle may exist without a consumer", () => {
  /**
   * The guard that stops this recurring.
   *
   * Every id in `HILLTOP_PLACEMENTS` is rendered as a toggle an operator can
   * flip, so every id has to be reachable by something. A placement is wired
   * either by naming a ZONE (the map) or by being read directly somewhere in
   * `features/` — anything else is a control that writes a value into the
   * database and changes nothing, which is the entire bug this file is about.
   */
  const CONSUMERS = [
    "features/monetization/hilltop-slot.tsx",
    "features/feed/use-hilltop-feed-slots.ts",
    "features/history/media-gallery.tsx",
  ];
  const sources = CONSUMERS.map((p) => read(p)).join("\n");
  const mapped = new Set(Object.values(HILLTOP_PLACEMENT_BY_ZONE));

  for (const pl of HILLTOP_PLACEMENTS) {
    it(`"${pl.id}" is wired to something`, () => {
      const viaZoneMap = mapped.has(pl.id);
      // `slot as HilltopPlacementId` covers the four in-page slots generically,
      // so a literal mention is the signal for the rest.
      const viaCode =
        sources.includes(`"${pl.id}"`) ||
        (["history", "historyfeed", "landing", "feed"] as string[]).includes(pl.id);
      expect(
        viaZoneMap || viaCode,
        `Placement "${pl.id}" ("${pl.label}") is a toggle in the admin panel that nothing reads. ` +
          `Add it to HILLTOP_PLACEMENT_BY_ZONE, or consult isHilltopPlacementOn(config, "${pl.id}") ` +
          `where it renders. A switch that saves and does nothing is worse than no switch.`,
      ).toBe(true);
    });
  }
});
