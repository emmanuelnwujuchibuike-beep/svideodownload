/**
 * Monetag Direct Link — one admin-set URL that a tap opens in a new tab.
 *
 * Owner, 2026-10-16: "Put a monetag direct link on the Wallpaper download
 * button, that shows randomly once when a user clicks anywhere around the
 * Wallpaper download button and also a direct link on the download result card
 * media preview section. Make admin can set up and configure the direct link
 * anytime."
 *
 * - Where: two spots (`DIRECT_LINK_SPOTS`), each with its own admin switch.
 * - "Randomly": an eligible tap opens the link with `chancePercent` odds.
 * - Every tap (owner, 2026-10-16: "it should show everytime the selected area
 *   i told you is tapped"): no once-per-session lock; each tap at an enabled
 *   spot rolls `chancePercent` — 100 opens it on every tap.
 * - It NEVER replaces the tap's own action: the download, the reward gate and
 *   the preview all carry on; the link opens beside them in a new tab.
 *
 * Lives in the `monetization` settings row, so no migration. Served through
 * /api/ads/config only when Monetag's master switch is on too.
 */

export const DIRECT_LINK_SPOTS = ["wallpaper", "resultPreview", "adClose"] as const;
export type DirectLinkSpot = (typeof DIRECT_LINK_SPOTS)[number];

/**
 * Which network fills a spot format (owner, 2026-10-24: "make the Monetag direct link and pop under to also use
 * adsterra pop under, smart link … I want to try adsterra out"). The admin picks ONE per format — the direct link and
 * the pop-under separately — and each network needs its own master switch on (Monetag / Adsterra). Same spots, same
 * tap rules: one physical spot, the provider is a setting.
 */
export const SPOT_AD_PROVIDERS = ["monetag", "adsterra"] as const;
export type SpotAdProvider = (typeof SPOT_AD_PROVIDERS)[number];
export const normalizeSpotAdProvider = (v: unknown): SpotAdProvider => (v === "adsterra" ? "adsterra" : "monetag");

export interface DirectLinkConfig {
  enabled: boolean;
  /** Which network's link a tap opens (2026-10-24). */
  provider: SpotAdProvider;
  /** The Monetag direct link. */
  url: string;
  /** The Adsterra Smartlink (its "Direct Link"). */
  adsterraUrl: string;
  spots: Record<DirectLinkSpot, boolean>;
  /** 1–100: the odds an eligible tap opens the link. */
  chancePercent: number;
}

export const DEFAULT_DIRECT_LINK: DirectLinkConfig = {
  enabled: false,
  provider: "monetag",
  url: "",
  adsterraUrl: "",
  // adClose (owner, 2026-10-19): the Download complete and reward ads' close control — see FullscreenInterstitial
  spots: { wallpaper: true, resultPreview: true, adClose: true },
  chancePercent: 50,
};

/** A link the browser may open: absolute https, no credentials, sane length. */
export function isValidDirectLinkUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Clamp a stored (possibly hand-edited or partial) blob to a safe config. */
export function normalizeDirectLink(raw: unknown): DirectLinkConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof DirectLinkConfig, unknown>>;
  const spotsRaw = (r.spots && typeof r.spots === "object" ? r.spots : {}) as Record<string, unknown>;
  const spots = Object.fromEntries(
    DIRECT_LINK_SPOTS.map((id) => [id, typeof spotsRaw[id] === "boolean" ? spotsRaw[id] : DEFAULT_DIRECT_LINK.spots[id]]),
  ) as Record<DirectLinkSpot, boolean>;
  const n = Number(r.chancePercent);
  const url = typeof r.url === "string" ? r.url.trim() : "";
  const adsterraUrl = typeof r.adsterraUrl === "string" ? r.adsterraUrl.trim() : "";
  return {
    // Must be literally true: a stored "false" string is truthy.
    enabled: r.enabled === true,
    // a row saved before 2026-10-24 has no provider: Monetag, as it was
    provider: normalizeSpotAdProvider(r.provider),
    url: isValidDirectLinkUrl(url) ? url : "",
    adsterraUrl: isValidDirectLinkUrl(adsterraUrl) ? adsterraUrl : "",
    spots,
    chancePercent: Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : DEFAULT_DIRECT_LINK.chancePercent,
  };
}

/**
 * The public shape /api/ads/config serves: null unless it can actually open.
 * The chosen provider's master switch gates it (`monetagOn` / `adsterraOn`): turning that network off turns this off.
 */
export function publicDirectLink(
  raw: unknown,
  monetagOn: boolean,
  adsterraOn = false,
): { provider: SpotAdProvider; url: string; spots: DirectLinkSpot[]; chancePercent: number } | null {
  const c = normalizeDirectLink(raw);
  const on = c.provider === "adsterra" ? adsterraOn : monetagOn;
  const url = c.provider === "adsterra" ? c.adsterraUrl : c.url;
  if (!on || !c.enabled || !url) return null;
  const spots = DIRECT_LINK_SPOTS.filter((id) => c.spots[id]);
  return spots.length ? { provider: c.provider, url, spots, chancePercent: c.chancePercent } : null;
}

/** The roll: `random` is in [0, 1). */
export function directLinkRollWins(chancePercent: number, random: number): boolean {
  return random * 100 < chancePercent;
}
