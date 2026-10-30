import { DIRECT_LINK_SPOTS, normalizeSpotAdProvider, normalizeSpots, type DirectLinkSpot, type SpotAdProvider } from "./direct-link";
import { parseMonetagSnippet } from "./monetag";

/**
 * Monetag Pop-under at the direct-link spots — the MAIN format there, the direct link the backup.
 *
 * Owner, 2026-10-23: "Make the X close button, Wallpapers, result card preview to also use pop
 * under format … make the pop under the main, and the direct link to be backup that only works
 * when there's no pop under or if the browser blocked it. Both shouldn't show."
 *
 * - Where: the same spots as the direct link (`DIRECT_LINK_SPOTS`), each with its own switch.
 * - The tag loads on the FIRST PRESS at an enabled spot (Part 2.1) — a page merely carrying a spot loads
 *   nothing. Other scripts' windows are never blocked (lib/monetization/open-observer.ts only counts them).
 *   ⚠️ Once loaded, Monetag's own script decides its later clicks (its frequency cap applies); confining it
 *   to the spots would need blocking every other script's windows, which Part 2.1 rules out.
 * - At a tap: the pop-under is tried; the direct link opens only when no pop-under opened (the tag
 *   didn't load, Monetag skipped this tap, or the browser blocked it). After the direct link opens,
 *   a late pop-under on that tap is refused for 1.5 s, so the two never both show.
 *
 * Lives in the `monetization` settings row (no migration); served by /api/ads/config only when
 * Monetag's master switch is on. Pre-filled with the owner's tag (zone 12054432) but OFF until an admin
 * switches it on (Part 2.1): no saved choice, or anything but a literal true, means off.
 */

export const OWNER_POPUNDER_SNIPPET =
  "<script>(function(s){s.dataset.zone='12054432',s.src='https://al5sm.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>";

export interface SpotPopunderConfig {
  enabled: boolean;
  /** Which network's pop-under loads at the spots (2026-10-24; see SPOT_AD_PROVIDERS). */
  provider: SpotAdProvider;
  /** The Monetag tag as pasted. Parsed to { src, zone } — never injected as raw HTML. */
  snippet: string;
  /** The Adsterra Popunder code as pasted (`<script src="//….js">`). Only its https script address is read. */
  adsterraSnippet: string;
  spots: Record<DirectLinkSpot, boolean>;
  /**
   * Less aggressive (owner, 2026-10-23: "make it less aggressive without breaking the Monetag impression and CPM
   * reading"). Once loaded, Monetag's script opens a pop-under on ANY click on the page; with this on, a window a
   * THIRD-PARTY script opens is let through only during a tap at one of the spots. Our own features' windows are never
   * touched. A pop-under that does show is a normal Monetag impression.
   */
  spotsOnly: boolean;
  /** At most one pop-under every this many minutes per visitor (0 = only Monetag's own cap). */
  cooldownMinutes: number;
}

export const POPUNDER_COOLDOWN_MAX_MINUTES = 1440;

/** Part 2.1: OFF until the admin switches it on (the owner's zone stays pre-filled in the tag box). */
export const DEFAULT_SPOT_POPUNDER: SpotPopunderConfig = {
  enabled: false,
  provider: "monetag",
  snippet: OWNER_POPUNDER_SNIPPET,
  adsterraSnippet: "",
  spots: { download: false, resultPreview: true, wallpaper: true, rewardAdClose: true, downloadAdClose: true, batchSave: false },
  spotsOnly: true,
  cooldownMinutes: 30,
};

export function normalizeSpotPopunder(raw: unknown): SpotPopunderConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof SpotPopunderConfig, unknown>>;
  return {
    // ON only when an admin saved a literal true — missing, a string "true", anything else: off (Part 2.1)
    enabled: r.enabled === true,
    // a row saved before 2026-10-24 has no provider: Monetag, as it was
    provider: normalizeSpotAdProvider(r.provider),
    snippet: typeof r.snippet === "string" ? r.snippet.trim().slice(0, 4000) : DEFAULT_SPOT_POPUNDER.snippet,
    adsterraSnippet: typeof r.adsterraSnippet === "string" ? r.adsterraSnippet.trim().slice(0, 4000) : DEFAULT_SPOT_POPUNDER.adsterraSnippet,
    spots: normalizeSpots(r.spots, DEFAULT_SPOT_POPUNDER.spots),
    // a row saved before these existed gets the gentle defaults
    spotsOnly: typeof r.spotsOnly === "boolean" ? r.spotsOnly : DEFAULT_SPOT_POPUNDER.spotsOnly,
    cooldownMinutes: Number.isFinite(r.cooldownMinutes) ? Math.max(0, Math.min(POPUNDER_COOLDOWN_MAX_MINUTES, Math.round(r.cooldownMinutes as number))) : DEFAULT_SPOT_POPUNDER.cooldownMinutes,
  };
}

export interface PublicSpotPopunder {
  provider: SpotAdProvider;
  src: string;
  zone: string | null;
  cfAsync: boolean;
  spots: DirectLinkSpot[];
  spotsOnly: boolean;
  cooldownMinutes: number;
}

/**
 * The Adsterra Popunder code: Adsterra hands out a plain `<script type='text/javascript' src='//pl….com/…/….js'></script>`.
 * Only a clean https script address is kept (protocol-relative becomes https); inline code, markup or http → null.
 * Adsterra codes carry no zone attribute — the unit is in the address.
 */
export function parseAdsterraSnippet(snippet: string | null | undefined): { src: string } | null {
  const tag = parseMonetagSnippet(snippet);
  return tag && /\.js$/i.test(new URL(tag.src).pathname) ? { src: tag.src } : null;
}

/**
 * What /api/ads/config serves: null unless it can actually load — switched on, a valid tag for the chosen network, a
 * spot, and that network's master switch: Monetag's for Monetag, ADSTERRA's for Adsterra (owner, 2026-10-30: "turned
 * off adsterra general but the reward X button is still showing the ad" — the Adsterra pop-under used to need only its
 * own switch + code, so switching Adsterra off never stopped it).
 */
export function publicSpotPopunder(raw: unknown, monetagOn: boolean, adsterraOn: boolean): PublicSpotPopunder | null {
  const c = normalizeSpotPopunder(raw);
  if (!c.enabled || (c.provider === "monetag" && !monetagOn) || (c.provider === "adsterra" && !adsterraOn)) return null;
  const adsterra = c.provider === "adsterra" ? parseAdsterraSnippet(c.adsterraSnippet) : null;
  const tag = c.provider === "adsterra" ? (adsterra ? { src: adsterra.src, zone: null, cfAsync: false } : null) : parseMonetagSnippet(c.snippet);
  if (!tag) return null;
  const spots = DIRECT_LINK_SPOTS.filter((id) => c.spots[id]);
  return spots.length ? { provider: c.provider, src: tag.src, zone: tag.zone, cfAsync: tag.cfAsync, spots, spotsOnly: c.spotsOnly, cooldownMinutes: c.cooldownMinutes } : null;
}

export type SpotOutcome = "popunder" | "direct" | "none";

/**
 * The one rule (pure): the pop-under wins when it opened (a window opened through the guard, or the
 * page lost focus to a new tab); otherwise the direct link, when one opened; otherwise nothing.
 */
export function spotOutcome(i: { popunderOpened: boolean; directOpened: boolean }): SpotOutcome {
  if (i.popunderOpened) return "popunder";
  return i.directOpened ? "direct" : "none";
}
