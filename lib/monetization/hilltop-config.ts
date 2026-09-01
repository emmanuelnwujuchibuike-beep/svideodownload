/**
 * HilltopAds — behaviour configuration, separate from the pasted tags.
 *
 * Owner, 2026-09-01 (the integration brief): "Create a central configuration
 * system … Do not hard-code values throughout the application", with per-
 * placement enable/disable, frequency caps, timeout and mobile/desktop
 * behaviour, and a master switch that turns HilltopAds off "without affecting
 * any other ad provider".
 *
 * ── Why this is a separate object from the snippets ───────────────────────────
 *
 * The snippet fields (`hilltopBannerSnippet`, `hilltopVideoSliderSnippet`) hold
 * the CREDENTIALS — the tag pasted out of their dashboard. This holds the
 * BEHAVIOUR. Keeping them apart means an operator can switch a placement off
 * and back on without deleting the tag they would have to go and fetch again,
 * which is the same mistake the ExoClick switch existed to prevent.
 *
 * It also means the brief's master switch is a real kill switch: `enabled:
 * false` is read before any tag is even resolved, so nothing about HilltopAds
 * reaches the browser, while every other network is untouched by it.
 */

/** Every HilltopAds placement that can be independently switched. */
export const HILLTOP_PLACEMENTS = [
  { id: "history", label: "History — above the grid", hint: "Banner above the saved-media grid." },
  { id: "historyfeed", label: "History — between time periods", hint: "Banner at the Yesterday and Last week boundaries." },
  { id: "landing", label: "Landing — under the wallpaper button", hint: "Banner below the Explore and Wallpaper cards." },
  { id: "feed", label: "Feed — in-feed banner", hint: "Banner in the scrolling feed, at its own interval." },
  { id: "historyvideo", label: "History — video between items", hint: "Full-screen video ad between saved media." },
  { id: "slider", label: "Video slider (site-wide)", hint: "Self-placing corner video. No position to choose." },
] as const;

export type HilltopPlacementId = (typeof HILLTOP_PLACEMENTS)[number]["id"];

const PLACEMENT_IDS = HILLTOP_PLACEMENTS.map((p) => p.id) as HilltopPlacementId[];

export interface HilltopConfig {
  /**
   * The master switch. OFF means no HilltopAds code runs at all — not a tag,
   * not a script, not a placement — and every other network carries on exactly
   * as before. Defaults OFF: a network ships wired and dormant, the same rule
   * the ExoClick master switch follows.
   */
  enabled: boolean;
  /** Per-placement switches, on top of the master. Absent means ON. */
  placements: Partial<Record<HilltopPlacementId, boolean>>;
  /**
   * One in-feed ad after every N organic posts (brief: "1 HilltopAds feed ad
   * every 8-12 organic feed items … Make this configurable rather than
   * hard-coded").
   *
   * ⚠️ Its OWN cadence, deliberately independent of `FEED_AD_INTERVAL`. The
   * existing in-feed zone keeps its interval and its keys untouched — changing
   * a working placement's rhythm to make room for a new network is exactly what
   * the brief's first rule prohibits.
   */
  feedEvery: number;
  /** One video ad after every N history items. Same reasoning. */
  historyVideoEvery: number;
  /**
   * How long a placement waits before it gives up and collapses.
   *
   * The brief: "Do not create an infinite loading spinner. Set a strict ad-load
   * timeout." Nothing here ever renders a spinner, so this is the window after
   * which a placement reports its outcome and stops holding any space.
   */
  timeoutMs: number;
  /** Serve on phones. */
  mobile: boolean;
  /** Serve on tablets and desktops. */
  desktop: boolean;
}

export const DEFAULT_HILLTOP: HilltopConfig = {
  // Dormant until an operator turns it on, like every other network here.
  enabled: false,
  placements: {},
  // The middle of the range the brief gives, so neither bound is a surprise.
  feedEvery: 10,
  historyVideoEvery: 10,
  timeoutMs: 10_000,
  mobile: true,
  desktop: true,
};

/** Lower bound on either cadence. Below this a feed is mostly advertising. */
export const HILLTOP_MIN_EVERY = 6;
/** Upper bound, so a typo cannot silently switch a placement off for ever. */
export const HILLTOP_MAX_EVERY = 40;

function clampEvery(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(HILLTOP_MAX_EVERY, Math.max(HILLTOP_MIN_EVERY, Math.round(value)));
}

/**
 * Coerce a stored value into a usable config, failing CLOSED on the master
 * switch and OPEN on everything else.
 *
 * A row written by an older build carries no `hilltop` key at all, and reading
 * a field off undefined would take the whole monetization panel down — the
 * failure this project has already had once with `vastInterstitial`.
 */
export function normalizeHilltop(value: unknown): HilltopConfig {
  const raw = (value ?? {}) as Partial<HilltopConfig>;
  const placements: Partial<Record<HilltopPlacementId, boolean>> = {};
  const stored = (raw.placements ?? {}) as Record<string, unknown>;
  for (const id of PLACEMENT_IDS) {
    // Only a real `false` switches a placement off. A truthy string or a null
    // from a hand-edited row must never be the thing that disables a placement,
    // and must never be the thing that enables one either.
    if (stored[id] === false) placements[id] = false;
  }
  return {
    enabled: raw.enabled === true,
    placements,
    feedEvery: clampEvery(raw.feedEvery, DEFAULT_HILLTOP.feedEvery),
    historyVideoEvery: clampEvery(raw.historyVideoEvery, DEFAULT_HILLTOP.historyVideoEvery),
    timeoutMs:
      typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? Math.min(30_000, Math.max(2_000, Math.round(raw.timeoutMs)))
        : DEFAULT_HILLTOP.timeoutMs,
    mobile: raw.mobile !== false,
    desktop: raw.desktop !== false,
  };
}

/** May this placement run at all? The master switch and its own, in one place. */
export function isHilltopPlacementOn(config: HilltopConfig, id: HilltopPlacementId): boolean {
  if (!config.enabled) return false;
  return config.placements?.[id] !== false;
}
