import { describe, expect, it } from "vitest";

import { getModule } from "./platform/modules";
import { PLATFORMS, SHOWCASE_PLATFORMS } from "./platforms";

/**
 * Platform brand accents — legibility, computed rather than eyeballed.
 *
 * The ~148 generated SEO pages paint `accent` as a full-bleed hero background and
 * lay the H1, tagline and supporting copy over it. Brand colours are chosen for
 * logos, not for holding text, so several of them fail WCAG against white:
 * Vimeo's #1ab7ea measures 2.33:1 and Snapchat's #fffc00 measures 1.10:1.
 *
 * This suite is what stops the next brand colour from shipping unreadable. It
 * recomputes the contrast from the declared accent, so adding a platform with a
 * pale brand and `accentForeground: "light"` fails here rather than in front of a
 * visitor.
 */

/* WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Composite `#rrggbb` over black at the given alpha — what the hero scrim does. */
function scrim(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  return `#${[0, 2, 4]
    .map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Every literal hex stop in an accent's Tailwind gradient.
 *
 * Tailwind palette names (`from-neutral-900`, `from-zinc-700`) resolve to values
 * this test cannot see, so they are skipped — all of them are deep neutrals that
 * carry white comfortably. The risk we are guarding against is a bright literal
 * brand hex, and those are always written as `#rrggbb`.
 */
function hexStops(accent: string): string[] {
  return [...accent.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => `#${m[1]}`);
}

/** Matches the `bg-black/35` scrim the SEO hero lays over light-foreground brands. */
const HERO_SCRIM = 0.35;

/** WCAG AA for normal-size text. The hero tagline is 18px, which is not "large". */
const AA_NORMAL = 4.5;

describe("platform count claims", () => {
  it("keeps the Download tagline's platform count true", () => {
    /*
     * The tagline said "20+ platforms" against a real 11. That is the same class
     * of error as the fabricated landing stats the Reality Ledger was built to
     * stop, and it slipped through because it lives in a registry rather than a
     * component, which is where the ledger's scanner looks.
     *
     * It matters more than most copy because /llms.txt republishes it verbatim to
     * AI crawlers, which have no way to check it and will repeat it.
     */
    const real = SHOWCASE_PLATFORMS.length;
    const tagline = getModule("download")!.tagline;

    const claimed = tagline.match(/(\d+)\s*\+?\s*(?:social\s+)?platforms/i);
    expect(claimed, `No platform count found in: "${tagline}"`).toBeTruthy();
    expect(Number(claimed![1]), `Tagline claims ${claimed![1]}, reality is ${real}`).toBe(real);
  });

  it("excludes the generic fallback from the advertised set", () => {
    // `generic` is a yt-dlp catch-all, not a platform anyone searches for. Counting
    // it would inflate every number derived from this list by one.
    expect(SHOWCASE_PLATFORMS.some((p) => p.id === "generic")).toBe(false);
  });
});

describe("platform accents — legibility", () => {
  it("declares a foreground for every platform", () => {
    for (const p of Object.values(PLATFORMS)) {
      expect(["light", "dark"], `${p.id}`).toContain(p.accentForeground);
    }
  });

  it("keeps white text legible on every light-foreground accent, after the scrim", () => {
    const failures: string[] = [];

    for (const p of SHOWCASE_PLATFORMS) {
      if (p.accentForeground !== "light") continue;

      for (const stop of hexStops(p.accent)) {
        const ratio = contrast(scrim(stop, HERO_SCRIM), "#ffffff");
        if (ratio < AA_NORMAL) {
          failures.push(`${p.id} stop ${stop} → ${ratio.toFixed(2)}:1 (needs ${AA_NORMAL})`);
        }
      }
    }

    expect(
      failures,
      `Accents too pale for white text even with the hero scrim:\n  ${failures.join("\n  ")}\n` +
        `Fix by setting accentForeground: "dark" for that platform.`,
    ).toHaveLength(0);
  });

  it("keeps black text legible on every dark-foreground accent", () => {
    const failures: string[] = [];

    for (const p of SHOWCASE_PLATFORMS) {
      if (p.accentForeground !== "dark") continue;

      for (const stop of hexStops(p.accent)) {
        // No scrim on these — darkening would fight the black text.
        const ratio = contrast(stop, "#000000");
        if (ratio < AA_NORMAL) {
          failures.push(`${p.id} stop ${stop} → ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures, `Accents too dark for black text:\n  ${failures.join("\n  ")}`).toHaveLength(0);
  });

  it("confirms Snapchat is the case that forced the foreground field", () => {
    // Regression guard with a story: #fffc00 against white is 1.10:1, and even a
    // 45% black scrim only reaches 3.62:1. If someone "simplifies" this back to a
    // universal white foreground, this is the test that explains why not.
    expect(PLATFORMS.snapchat.accentForeground).toBe("dark");
    expect(contrast("#fffc00", "#ffffff")).toBeLessThan(2);
    expect(contrast(scrim("#fffc00", 0.45), "#ffffff")).toBeLessThan(AA_NORMAL);
    expect(contrast("#fffc00", "#000000")).toBeGreaterThan(15);
  });
});
