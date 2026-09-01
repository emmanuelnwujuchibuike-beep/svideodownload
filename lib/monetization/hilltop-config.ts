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
  { id: "wallpaper", label: "Wallpaper download — reward video", hint: "The VAST video watched before a wallpaper download." },
  { id: "download", label: "Download complete — VAST video", hint: "Replaces whatever else is configured on the download-complete moment." },
  { id: "idle", label: "Idle interstitial — inline video", hint: "The video slider tag, shown full-screen when the reader goes idle." },
  { id: "slider", label: "Video slider (site-wide)", hint: "Self-placing corner video. No position to choose." },
] as const;

export type HilltopPlacementId = (typeof HILLTOP_PLACEMENTS)[number]["id"];

const PLACEMENT_IDS = HILLTOP_PLACEMENTS.map((p) => p.id) as HilltopPlacementId[];

/**
 * Which HilltopAds product fills a given AD ZONE.
 *
 * Owner, 2026-09-01: "the exoclick preparing and result video ad should be
 * changed to hiltop video slider … disable the exoclick ads generally and
 * replace with hiltop video slider and vast … the history after 3 videos watched
 * to be hiltop video slider or vast … only the reels and wallpaper scroll to be
 * blank … wallpaper should use only hiltop video slider for download started and
 * also for download completed but not for reward".
 *
 * 🔴 A MAP, NOT A LIST OF SPECIAL CASES. Those instructions moved four times in
 * one day — VAST here, slider there, blank on two surfaces, and the wallpaper
 * reward explicitly excluded from the slider it uses everywhere else. Each round
 * as a code branch would be a code change for what is really an operator
 * decision, and the branches would drift out of step with each other.
 *
 *   `off`    — Hilltop does not serve this zone. Whatever served it before still
 *              does, and where nothing else is configured the zone is blank.
 *   `banner` — the MultiTag Banner 300x250, rendered in a frame.
 *   `slider` — the MultiTag Video Slider tag, as an in-page unit.
 *   `vast`   — the VAST 3.0 tag, played by our own player.
 *
 * ── 🔴 THE SLIDER IS NOT AN OVERLAY CREATIVE ─────────────────────────────────
 *
 * Owner, 2026-09-01, twice: the idle interstitial and then the download-complete
 * overlay "shows blank", with a screenshot of a black sheet carrying nothing but
 * Hilltop's own mute button.
 *
 * That is the slider working as designed, in the wrong place. It is a
 * SELF-PLACING product: it slides its own small player into a corner of a real
 * page on the network's schedule. Handed a fixed box and asked to be a takeover
 * it initialises — which is why its mute button appears — and then has no
 * surface to slide into, so the box stays empty.
 *
 * So an overlay moment gets a product built to be placed:
 *   • `vast` where our own player owns the surface (the VAST interstitial and
 *     the reward gate both play a tag we hand them),
 *   • `banner` where the surface is a frame in the page — which is the one
 *     Hilltop product observed rendering reliably here.
 * The slider stays available in the picker for anyone who wants to try it, and
 * it is still the right thing site-wide, where it can place itself.
 */
export type HilltopZoneSource = "off" | "banner" | "slider" | "vast";

/**
 * The default source per zone — the arrangement the owner asked for.
 *
 * ⚠️ Anything absent is `off`. That is what keeps reels and the wallpaper scroll
 * blank without naming them: a zone has to be listed here to get a Hilltop unit
 * at all, so a zone added later cannot quietly inherit one.
 */
export const DEFAULT_HILLTOP_ZONE_SOURCE: Record<string, HilltopZoneSource> = {
  /*
    "the exoclick preparing and result video ad should be changed to hiltop
    video slider" — the MOMENTS are as asked; the product is the one that
    renders in them. Each of these is played by our own VAST player, which is
    what a VAST tag is for, and the slider is measured blank there.
  */
  /*
    🔴 ONLY TWO MOMENTS ARE PLAYED BY OUR VAST PLAYER. Everything else renders an
    ad ROW through `AdSlot`, and AdSlot has NO VIDEO BRANCH — a `vast` row there
    resolves, reports itself present, and paints nothing. That is the broken
    black video card the owner photographed on the result screen
    (2026-09-01: "the result card show a blank video card instead of the hiltop
    banner"), and it is the same failure the slider had in the overlays, arrived
    at from the other direction.

    `requestVastInterstitial` — and therefore `/api/ads/exoclick` — owns exactly
    these two:
  */
  download_preparing: "vast",
  download_complete: "vast",
  // The batch / HD / top-quality gate and its completion, each on its own timer.
  batch_download_gate: "vast",
  batch_download_complete: "vast",

  /*
    Everything below renders through AdSlot, so it takes the BANNER: the one
    Hilltop product observed painting reliably in a frame.

    "the result shows the exoclick banner instead of the hiltop banner", "replace
    all exoclick vast video between sections with a hiltop banner", "i want
    hiltop banner to show in under the download button where adsterra banner slot
    is … and it should be in both".
  */
  result_top: "banner",
  download_result_page: "banner",
  under_download: "banner",
  /*
    🔴 `vast`, because the IN-PAGE POSITIONS now OPEN the interstitial and this
    is the zone that trigger resolves. Probed on production while it was
    `banner`: /api/ads/exoclick?zone=landing_section_break answered
    `{"ad":null}` — the VAST endpoint only serves a zone whose source is `vast`,
    so every in-page position was firing a trigger that could never fill.
  */
  landing_section_break: "vast",
  /*
    The story ad between history media plays through the VAST player now, not
    AdSlot — see the `history-story` trigger. Owner: "history view after 3 view
    is showing banner instead of vast that shows on interstilla".
  */
  history_story_ad: "vast",
  /*
    The idle overlay plays the video too. `IdleInterstitial` stands down when
    this is `vast` and the `ambient` trigger takes the moment instead — see the
    trigger map. Set it to `banner` to get the in-page unit back.
  */
  idle_interstitial: "vast",
  /*
    ⚠️ The reward gate too, and for the same mechanical reason rather than a
    change of intent: it renders through `FullscreenInterstitial` → `AdSlot`, so
    a `vast` row here shows nothing and the gate fails open — the download is
    released with no ad seen at all. A banner held for the configured 15 seconds
    is an ad the visitor actually watches, which is what the gate is for.
  */
  wallpaper_reward: "vast",
};

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
  /**
   * Per-zone source overrides, on top of `DEFAULT_HILLTOP_ZONE_SOURCE`.
   *
   * Only zones an operator has actually changed are stored, so the defaults
   * above stay the single description of the intended arrangement and a zone
   * added to them later reaches every existing install.
   */
  zoneSource: Record<string, HilltopZoneSource>;
  /**
   * Banner or in-page VIDEO for each of the in-page slots.
   *
   * Owner, 2026-09-01: "replace all hiltop banner with vast in everywhere they
   * are in landing page and history page, except from the top history hiltop
   * banner and the landing under the download button".
   *
   * 🔴 IN-PAGE VIDEO MEANS THE SLIDER, NOT VAST. VAST is a tag a PLAYER plays,
   * and the only player here is the full-screen overlay — there is no in-page
   * VAST unit, and inventing one is a video player, not a setting. The slider IS
   * Hilltop's in-page video product, so it is what an in-page slot can show.
   *
   * ⚠️ UNPROVEN IN THIS POSITION. The slider rendered blank when it was forced
   * into a fixed overlay box, which is a different failure (it is self-placing
   * and had nowhere to slide). In a real in-page frame it should behave as
   * designed — but that has not been observed yet, so every slot is switchable
   * and flipping one back to `banner` restores exactly what works today.
   */
  slotSource: Record<string, "banner" | "slider" | "interstitial">;
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
  zoneSource: {},
  /*
    `history` stays a banner — "except from the top history hiltop banner". The
    rest take the in-page video the owner asked for.
  */
  /*
    `history` — the one above the grid — stays a banner, exactly as asked. Every
    other in-page position OPENS THE INTERSTITIAL when it is scrolled to, rather
    than rendering a unit of its own: "it should be the vast video, only the
    first above the grid should be hiltop banner".
  */
  /*
    Owner, 2026-09-01: "i notice the hiltop vast doesnt work on placement, so put
    the hiltop banner back in the history page." So both HISTORY positions render
    a banner — the one above the grid and the period separators — and the landing
    and feed positions open the interstitial.
  */
  slotSource: {
    history: "banner",
    historyfeed: "banner",
    landing: "interstitial",
    feed: "interstitial",
  },
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
  const zoneSource: Record<string, HilltopZoneSource> = {};
  const storedSources = (raw.zoneSource ?? {}) as Record<string, unknown>;
  for (const [zone, value] of Object.entries(storedSources)) {
    if (value === "off" || value === "banner" || value === "slider" || value === "vast") {
      zoneSource[zone] = value;
    }
  }
  const slotSource: Record<string, "banner" | "slider" | "interstitial"> = {
    ...DEFAULT_HILLTOP.slotSource,
  };
  const storedSlots = (raw.slotSource ?? {}) as Record<string, unknown>;
  for (const [slot, value] of Object.entries(storedSlots)) {
    if (value === "banner" || value === "slider" || value === "interstitial") {
      slotSource[slot] = value;
    }
  }
  return {
    enabled: raw.enabled === true,
    placements,
    zoneSource,
    slotSource,
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

/**
 * Which Hilltop product serves this zone, if any.
 *
 * The master switch first: off means `off` everywhere, so one toggle really does
 * remove HilltopAds from the site.
 */
export function hilltopZoneSource(config: HilltopConfig, zone: string): HilltopZoneSource {
  if (!config.enabled) return "off";
  const override = config.zoneSource?.[zone];
  if (override === "off" || override === "slider" || override === "vast") return override;
  return DEFAULT_HILLTOP_ZONE_SOURCE[zone] ?? "off";
}

/** May this placement run at all? The master switch and its own, in one place. */
export function isHilltopPlacementOn(config: HilltopConfig, id: HilltopPlacementId): boolean {
  if (!config.enabled) return false;
  return config.placements?.[id] !== false;
}
