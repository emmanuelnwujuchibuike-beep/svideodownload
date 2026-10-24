/**
 * Monetag Direct Link — one admin-set URL that a tap opens in a new tab.
 *
 * Owner, 2026-10-16: "Put a monetag direct link on the Wallpaper download
 * button, that shows randomly once when a user clicks anywhere around the
 * Wallpaper download button and also a direct link on the download result card
 * media preview section. Make admin can set up and configure the direct link
 * anytime."
 *
 * - Where: the ad spots (`DIRECT_LINK_SPOTS`), each with its own admin switch.
 * - "Randomly": an eligible tap opens the link with `chancePercent` odds.
 * - Every tap (owner, 2026-10-16: "it should show everytime the selected area
 *   i told you is tapped"): no once-per-session lock; each tap at an enabled
 *   spot rolls `chancePercent` — 100 opens it on every tap.
 * - It NEVER replaces the tap's own action: the download, the reward gate and
 *   the preview all carry on; the link opens beside them in a new tab.
 *
 * Lives in the `monetization` settings row, so no migration. Served through
 * /api/ads/config only when Monetag's master switch is on too.
 *
 * The Adsterra SMARTLINK (owner, 2026-10-24) is a SEPARATE backup with its own switch, chance and spots
 * (`AdsterraSmartlinkConfig` below): "the smart link will be as a separate backup that show randomly … Not all part
 * should be separated so I can decide to turn off some". At a tap: the pop-under first, then the Monetag link (its
 * chance), then the Smartlink (its chance) — at most ONE of them per tap.
 */

/**
 * The ad spots (owner, 2026-10-24: "Download, reward ad X button, Download complete ad X button, Wallpaper Download
 * button, the general result" — each separately switchable). Before, one `adClose` spot covered both ad X buttons and
 * the result card's Download button was no spot at all; a saved `adClose` choice is read as both X spots.
 */
export const DIRECT_LINK_SPOTS = ["download", "resultPreview", "wallpaper", "rewardAdClose", "downloadAdClose"] as const;
export type DirectLinkSpot = (typeof DIRECT_LINK_SPOTS)[number];

/** What the admin reads for each spot. */
export const DIRECT_LINK_SPOT_LABELS: Record<DirectLinkSpot, { label: string; hint: string }> = {
  download: { label: "Download button", hint: "The Download button on the download result card" },
  resultPreview: { label: "Result preview", hint: "A tap on the media preview at the top of the download result card" },
  wallpaper: { label: "Wallpaper download", hint: "A tap around the wallpaper viewer's Download button" },
  rewardAdClose: { label: "Reward ad X", hint: "The X / Skip of the reward ads (wallpaper reward, sponsor reward video)" },
  downloadAdClose: { label: "Download-complete ad X", hint: "The X / Skip of the Download complete and other full-screen ads" },
};

/** The ad X spot a full-screen ad uses: the reward ads have their own switch. */
export const adCloseSpot = (reward: boolean): DirectLinkSpot => (reward ? "rewardAdClose" : "downloadAdClose");

/**
 * Which network fills the POP-UNDER (owner, 2026-10-24: "use adsterra pop under"). The admin picks one; the direct
 * links are separate formats (Monetag's link, Adsterra's Smartlink), each with its own switch.
 */
export const SPOT_AD_PROVIDERS = ["monetag", "adsterra"] as const;
export type SpotAdProvider = (typeof SPOT_AD_PROVIDERS)[number];
export const normalizeSpotAdProvider = (v: unknown): SpotAdProvider => (v === "adsterra" ? "adsterra" : "monetag");

/**
 * One spot map from a stored blob. A spot absent from the blob takes the default — except the two ad X spots, which
 * take a saved legacy `adClose` choice first (before 2026-10-24 one switch covered both).
 */
export function normalizeSpots(raw: unknown, defaults: Record<DirectLinkSpot, boolean>): Record<DirectLinkSpot, boolean> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const legacyClose = typeof r.adClose === "boolean" ? r.adClose : null;
  return Object.fromEntries(
    DIRECT_LINK_SPOTS.map((id) => {
      if (typeof r[id] === "boolean") return [id, r[id]];
      if ((id === "rewardAdClose" || id === "downloadAdClose") && legacyClose !== null) return [id, legacyClose];
      return [id, defaults[id]];
    }),
  ) as Record<DirectLinkSpot, boolean>;
}

export interface DirectLinkConfig {
  enabled: boolean;
  /** The Monetag direct link. */
  url: string;
  spots: Record<DirectLinkSpot, boolean>;
  /** 1–100: the odds an eligible tap opens the link. */
  chancePercent: number;
}

export const DEFAULT_DIRECT_LINK: DirectLinkConfig = {
  enabled: false,
  url: "",
  // the ad X spots (owner, 2026-10-19): the Download complete and reward ads' close control — see FullscreenInterstitial.
  // The result card's Download button (2026-10-24) starts OFF: it was never a spot before.
  spots: { download: false, resultPreview: true, wallpaper: true, rewardAdClose: true, downloadAdClose: true },
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

const chance = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : fallback;
};

/** Clamp a stored (possibly hand-edited or partial) blob to a safe config. */
export function normalizeDirectLink(raw: unknown): DirectLinkConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof DirectLinkConfig, unknown>>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  return {
    // Must be literally true: a stored "false" string is truthy.
    enabled: r.enabled === true,
    url: isValidDirectLinkUrl(url) ? url : "",
    spots: normalizeSpots(r.spots, DEFAULT_DIRECT_LINK.spots),
    chancePercent: chance(r.chancePercent, DEFAULT_DIRECT_LINK.chancePercent),
  };
}

export interface PublicDirectLink {
  url: string;
  spots: DirectLinkSpot[];
  chancePercent: number;
}

/**
 * The public shape /api/ads/config serves: null unless it can actually open.
 * `monetagOn` is Monetag's master switch: turning Monetag off turns this off.
 */
export function publicDirectLink(raw: unknown, monetagOn: boolean): PublicDirectLink | null {
  const c = normalizeDirectLink(raw);
  if (!monetagOn || !c.enabled || !c.url) return null;
  const spots = DIRECT_LINK_SPOTS.filter((id) => c.spots[id]);
  return spots.length ? { url: c.url, spots, chancePercent: c.chancePercent } : null;
}

/* ───────────────────────── Adsterra Smartlink (a separate backup) ───────────────────────── */

export interface AdsterraSmartlinkConfig {
  enabled: boolean;
  /** Adsterra's Smartlink ("Direct Link") URL. */
  url: string;
  spots: Record<DirectLinkSpot, boolean>;
  /** 1–100: the odds an eligible tap opens it (when nothing else opened on that tap). */
  chancePercent: number;
}

export const DEFAULT_ADSTERRA_SMARTLINK: AdsterraSmartlinkConfig = {
  enabled: false,
  url: "",
  spots: { download: false, resultPreview: false, wallpaper: false, rewardAdClose: false, downloadAdClose: false },
  chancePercent: 50,
};

export function normalizeAdsterraSmartlink(raw: unknown): AdsterraSmartlinkConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof AdsterraSmartlinkConfig, unknown>>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  return {
    enabled: r.enabled === true,
    url: isValidDirectLinkUrl(url) ? url : "",
    spots: normalizeSpots(r.spots, DEFAULT_ADSTERRA_SMARTLINK.spots),
    chancePercent: chance(r.chancePercent, DEFAULT_ADSTERRA_SMARTLINK.chancePercent),
  };
}

/**
 * Served on its OWN switch and URL — never the Adsterra banner switch (that would also turn Adsterra banners on) nor
 * Monetag's. Null unless it can actually open.
 */
export function publicAdsterraSmartlink(raw: unknown): PublicDirectLink | null {
  const c = normalizeAdsterraSmartlink(raw);
  if (!c.enabled || !c.url) return null;
  const spots = DIRECT_LINK_SPOTS.filter((id) => c.spots[id]);
  return spots.length ? { url: c.url, spots, chancePercent: c.chancePercent } : null;
}

/** The roll: `random` is in [0, 1). */
export function directLinkRollWins(chancePercent: number, random: number): boolean {
  return random * 100 < chancePercent;
}
