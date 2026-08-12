import { createAdminClient } from "@/lib/supabase/admin";

import {
  isMonetagAdType,
  isMonetagPlacementId,
  isMonetagSurfaceId,
  type MonetagPlacement,
  type MonetagUnit,
} from "./monetag";

/**
 * Global monetization switches, stored in the `settings` table under key
 * `monetization` so an admin can flip whole subsystems on/off from the
 * dashboard without a redeploy. Mirrors the pricing / plan-limits pattern.
 *
 * Defaults: everything ON (the historical behaviour), so an unconfigured site
 * behaves exactly as before.
 */

export interface MonetizationSettings {
  /** Google AdSense units (banners, and the video placements). */
  adsense: boolean;
  /**
   * AdSense publisher id (`ca-pub-…`) for the SITE-LEVEL script.
   *
   * ── Why this is separate from an ad unit's `ad_client` ────────────────────
   *
   * AdSense asks for two different things and they are easy to confuse. An ad
   * UNIT has a publisher id AND a slot id, and renders where you place it. The
   * snippet AdSense gives you to verify a site — and to run Auto ads — has a
   * publisher id and NO slot, belongs in `<head>` on every page, and renders
   * nothing by itself.
   *
   * The ad-placement form only accepted the first shape, so there was nowhere
   * to put the verification snippet at all. This is that field.
   */
  adsensePublisherId: string;
  /**
   * The literal contents of `/ads.txt`.
   *
   * Stored rather than generated because the line AdSense issues ends with a
   * verification hash unique to the account — `google.com, pub-…, DIRECT,
   * f08c47fec0942fa0` — which cannot be derived from the publisher id. Held as
   * free text so additional networks' lines can be pasted in alongside it,
   * which is exactly how ads.txt is meant to be used.
   */
  adsTxt: string;
  /**
   * Site-ownership verification meta tags, as `name|content` pairs, one per line.
   *
   * ── Why this exists ───────────────────────────────────────────────────────
   *
   * Every ad network verifies ownership, and each offers the same three or four
   * methods: a file at the site root, a meta tag, or a DNS record. The FILE
   * method is the one that cannot be supported here — Monetag/PropellerAds asks
   * for `sw.js` in the root directory, and that path is already the Frenz
   * service worker. Overwriting it would destroy offline caching, push
   * notifications, background sync and the installed-app experience, to verify
   * an ad account.
   *
   * The meta-tag method costs one line in `<head>` and conflicts with nothing,
   * so it is the one this site supports, generically, for any network.
   *
   * ── Structured pairs, not raw HTML ────────────────────────────────────────
   *
   * Stored as `name|content` and rendered into a real `<meta>` element rather
   * than injected as markup. An admin-only free-text field that reaches `<head>`
   * unescaped is a stored-XSS primitive with extra steps — and one compromised
   * or careless admin session should not be able to put a script on every page.
   */
  verificationTags: string;
  /**
   * The Google tag: a GA4 measurement id, a Google Ads conversion id, or a
   * Tag Manager container id. One field, because Google's own installer emits
   * the same snippet shape for all three and only the id differs.
   *
   * Stored as the ID ONLY, never as pasted markup. Google's install page hands
   * you a block of <script> to copy, and accepting that verbatim would put an
   * admin-editable script on every page of the site — a stored-XSS primitive
   * with a friendly name. The id is validated against the real formats and the
   * snippet is rendered from a template here, exactly as `verificationTags`
   * takes name/content pairs rather than raw <meta> markup.
   *
   *   G-XXXXXXXXXX   GA4
   *   AW-XXXXXXXXX   Google Ads
   *   GTM-XXXXXXX    Tag Manager
   */
  googleTagId: string;
  /** Adsterra networks. */
  adsterra: boolean;
  /** PropellerAds networks. */
  propellerads: boolean;
  /**
   * Monetag — a single site-wide "Multitag" that serves all Monetag formats
   * (in-page push, interstitial, vignette, etc.) from one script. The owner's
   * chosen network alongside AdSense (Adsterra/PropellerAds retired).
   */
  monetag: boolean;
  /**
   * The Monetag Multitag <script> snippet, pasted verbatim from the Monetag
   * dashboard. It is PARSED server-side into a structured <script> (src +
   * data-zone) — never injected as raw markup — so an admin field can't become a
   * stored-XSS primitive. Also satisfies Monetag's "code" verification method,
   * because the tag is server-rendered where Monetag's crawler can see it. The
   * FILE method (sw.js at root) is impossible here — that path is the PWA service
   * worker. See features/monetization/monetag-script.tsx.
   */
  monetagSnippet: string;
  /**
   * Per-type Monetag tags, beyond the primary Multitag above.
   *
   * Monetag's formats — In-Page Push, Push Notifications, Vignette Banner, OnClick
   * / Popunder — are each a separate self-placing site-level `<script>` with its
   * own `data-zone`, distinct from Adsterra's banner-shaped units. Each entry is
   * `{ type, snippet }`; the snippet is PARSED (never injected) at render time by
   * `MonetagScript` via `resolveMonetagTags`. All are gated by the `monetag`
   * master switch. See lib/monetization/monetag.ts.
   */
  monetagUnits: MonetagUnit[];
  /**
   * Whether Monetag shows on every page (the default) or only the selected
   * surfaces. When false, `monetagSurfaces` lists where it may appear.
   */
  monetagAllPages: boolean;
  /**
   * The page surfaces Monetag may show on when `monetagAllPages` is false —
   * surface ids from `MONETAG_SURFACES` (home / downloader / content / info /
   * app). Matched on the client against the current path. See monetag.ts.
   */
  monetagSurfaces: string[];
  /**
   * Moment placements: a Monetag tag to load at a specific moment (after a
   * download, on the HD reward, a full-screen interstitial, idle, return, back-
   * swipe). One tag per moment; loaded lazily on the client when the moment fires.
   * See lib/monetization/monetag.ts and features/monetization/monetag-placements.tsx.
   */
  monetagPlacements: MonetagPlacement[];
  /** Affiliate offers on the download-result page. */
  affiliates: boolean;
  /** Curated "Recommended Tools" sections (homepage/footer/sidebar/blog). */
  recommendedTools: boolean;
  /**
   * Allow interstitial / full-page units — the idle and download-complete
   * placements, and any `video` unit.
   *
   * Defaults OFF. These are the most intrusive placements on the site and
   * turning them on should be a deliberate act, not something inherited by a
   * site that never configured anything.
   */
  interstitial: boolean;
  /**
   * How long (seconds) before an interstitial can be skipped: 0 = skip
   * immediately, or 5 / 10 for a countdown first. Applies to the download-flow
   * interstitial (idle / after N downloads / after N history watches). Only 0, 5
   * and 10 are offered in the admin; any other value is clamped on read.
   */
  interstitialSkipSeconds: number;
  /**
   * Full-screen interstitial after every 2nd wallpaper download, on the
   * standalone /wallpapers page and the download page's Wallpapers section.
   *
   * Its own switch rather than riding on `interstitial`: a wallpaper download
   * is a different moment from a video download, and an operator running one
   * should not be forced to run the other. Like `interstitial`, it defaults OFF
   * — the most intrusive placements are opt-in, never inherited.
   */
  interstitialWallpaper: boolean;
  /**
   * Full-screen interstitial when the 2nd video watched from download history
   * FINISHES. Fires on the natural end of a clip only, never mid-watch.
   */
  interstitialHistoryVideo: boolean;
  /**
   * Batch (multi-item) downloads are FREE, paid for by a full-screen ad before
   * the batch runs and a short one after it finishes.
   *
   * Owner (2026-08-09): batch used to be a Pro gate. An upgrade prompt earns
   * nothing from the overwhelming majority who will never buy; an ad earns
   * something from all of them and still lets them have the feature. Pro
   * members skip both ads, which is what they are paying for.
   *
   * Defaults OFF like every other interstitial: the most intrusive placements
   * are opt-in, never inherited by a site that configured nothing.
   */
  interstitialBatchDownload: boolean;
  /**
   * Seconds before the PRE-batch ad can be skipped (owner: 30). Separate from
   * `interstitialSkipSeconds` because this one is the price of the feature
   * rather than an interruption, and a 30-second countdown on an idle ad would
   * be intolerable.
   */
  batchGateSeconds: number;
  /** Seconds before the POST-batch ad can be skipped (owner: 5). */
  batchCompleteSeconds: number;
  /**
   * Allow pop-under / OnClick units (the `pop` format).
   *
   * Defaults OFF, unlike the original switch which defaulted ON. These take
   * over the visitor's next click, so running them has to be a deliberate act
   * rather than something a site inherits by never configuring anything.
   *
   * ⚠️ Turning this on while an AdSense application is under review is the most
   * common reason a site is rejected — Google prohibits units that interfere
   * with navigation, and a reviewer meeting a pop-under is meeting exactly
   * that. Both can be configured here; running them together is a real risk to
   * the AdSense account.
   */
  popunder: boolean;
}
export const DEFAULT_MONETIZATION: MonetizationSettings = {
  adsense: true,
  /*
    Empty by default. A publisher id is account-specific, so a hardcoded one
    would either be wrong or would quietly attribute another site's traffic —
    and an empty value means no script is emitted at all, which is the correct
    behaviour for a site that has not set one up.
  */
  adsensePublisherId: "",
  adsTxt: "",
  verificationTags: "",
  googleTagId: "",
  /*
    Adsterra + PropellerAds default OFF (owner, 2026-07-26: "use just Monetag and
    AdSense"). They remain fully wired so a site can re-enable them from the admin,
    but a fresh site now leans on AdSense + Monetag. Monetag itself defaults off
    until its Multitag snippet is pasted in the admin.
  */
  adsterra: false,
  propellerads: false,
  monetag: false,
  monetagSnippet: "",
  monetagUnits: [],
  // Back-compat: an existing site keeps showing Monetag everywhere until the
  // owner narrows it. `monetagSurfaces` only applies when this is false.
  monetagAllPages: true,
  monetagSurfaces: [],
  monetagPlacements: [],
  affiliates: true,
  recommendedTools: true,
  interstitial: false,
  interstitialSkipSeconds: 5,
  interstitialWallpaper: false,
  interstitialHistoryVideo: false,
  interstitialBatchDownload: false,
  batchGateSeconds: 30,
  batchCompleteSeconds: 5,
  popunder: false,
};

/** Keep only well-formed Monetag units (known type + string snippet), capped. */
export function normalizeMonetagUnits(value: unknown): MonetagUnit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (u): u is MonetagUnit =>
        !!u && isMonetagAdType((u as MonetagUnit).type) && typeof (u as MonetagUnit).snippet === "string",
    )
    .slice(0, 20)
    .map((u) => ({ type: u.type, snippet: u.snippet.slice(0, 4000) }));
}

/** Keep one well-formed placement per moment (known moment + string snippet). */
export function normalizeMonetagPlacements(value: unknown): MonetagPlacement[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: MonetagPlacement[] = [];
  for (const p of value) {
    const moment = (p as MonetagPlacement)?.moment;
    const snippet = (p as MonetagPlacement)?.snippet;
    if (!isMonetagPlacementId(moment) || typeof snippet !== "string" || seen.has(moment)) continue;
    seen.add(moment);
    out.push({ moment, snippet: snippet.slice(0, 4000) });
  }
  return out;
}

/** Interstitial skip delays offered in the admin (seconds). */
export const INTERSTITIAL_SKIP_OPTIONS = [0, 5, 10] as const;

/** Clamp a stored skip value to an offered option (defends against bad data). */
export function normalizeSkipSeconds(value: unknown): number {
  const n = Number(value);
  return (INTERSTITIAL_SKIP_OPTIONS as readonly number[]).includes(n) ? n : 5;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: MonetizationSettings } | null = null;
/*
  Short, because this gates whether an ad shows at all.

  `setMonetizationSettings` clears the cache on the instance that handled the
  save, but on a multi-instance deploy every OTHER instance keeps its copy until
  this expires — so this TTL is the real ceiling on "I turned Adsterra off and
  it is still showing". Sixty seconds made the switch feel broken; ten keeps the
  query cheap while making the change effectively immediate.
*/
const TTL_MS = 10_000;

/**
 * Settings, plus whether they are REAL.
 *
 * ── Why the distinction has to exist (owner, 2026-08-10) ─────────────────────
 * `getMonetizationSettings()` swallows every failure and returns the defaults.
 * For every caller that decides whether to SHOW an ad that is the right
 * behaviour: a database blip should not paint an ad frame, and defaults are the
 * safe direction.
 *
 * `/ads.txt` is the one caller where it is exactly backwards. There, defaults
 * mean an empty `adsTxt`, which the route reported as 404 — and a 4xx tells
 * Google the file authoritatively does not exist, a verdict it then keeps for
 * days. So one unlucky second of Supabase trouble showed up as "Ads.txt status:
 * Not found" against a setting that was saved and a file that served perfectly
 * on every manual check afterwards.
 *
 * A caller that must not confuse "nothing configured" with "could not read"
 * uses this; everything else keeps the simpler function below.
 */
/*
  The last AdSense publisher id this instance actually READ successfully.

  Purely a degraded-path aid for `/ads.txt`. The settings cache has a TTL and is
  dropped on write, so once it lapses a failed read leaves the route with nothing
  to serve but a 503 — and a 503 is not a record. The publisher id, unlike the
  rest of settings, is an identity that changes roughly never, so remembering the
  last one seen costs nothing and means an outage that begins AFTER this instance
  has served one request cannot take the file away.

  Deliberately not part of `cache`: it must outlive the TTL and outlive
  invalidation, and it is never used while a fresh read is available.
*/
let lastKnownPublisherId = "";

/** The last successfully-read publisher id, or "" if this instance never read one. */
export function lastKnownAdsensePublisherId(): string {
  return lastKnownPublisherId;
}

export interface MonetizationRead {
  settings: MonetizationSettings;
  /** True when the stored settings could not be read and these are defaults. */
  degraded: boolean;
}

export async function readMonetizationSettings(): Promise<MonetizationRead> {
  if (cache && Date.now() - cache.at < TTL_MS) return { settings: cache.value, degraded: false };
  /*
    No Supabase configured is NOT degraded — it is a complete, correct answer
    for a deployment that has no settings store. Only a failed read is degraded.
  */
  if (!hasSupabase) return { settings: DEFAULT_MONETIZATION, degraded: false };
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("settings")
      .select("value")
      .eq("key", "monetization")
      .maybeSingle();
    /*
      🔴 `error` was previously destructured away and ignored, so a failed query
      fell through to the merge and produced defaults that looked like a
      successful read of an unconfigured site. That is the whole bug, in one
      discarded variable.
    */
    if (error) return { settings: DEFAULT_MONETIZATION, degraded: true };
    const merged: MonetizationSettings = {
      ...DEFAULT_MONETIZATION,
      ...((data?.value ?? {}) as Partial<MonetizationSettings>),
    };
    // Normalise the Monetag units: a stored array can carry bad data (an unknown
    // type, a non-string snippet), and a malformed entry must degrade to nothing
    // rather than reach the head unparsed.
    merged.monetagUnits = normalizeMonetagUnits(merged.monetagUnits);
    // Keep only known surface ids, so a stale/garbage entry can't widen scope.
    merged.monetagSurfaces = Array.isArray(merged.monetagSurfaces)
      ? merged.monetagSurfaces.filter(isMonetagSurfaceId)
      : [];
    merged.monetagPlacements = normalizeMonetagPlacements(merged.monetagPlacements);
    cache = { at: Date.now(), value: merged };
    if (merged.adsensePublisherId.trim()) lastKnownPublisherId = merged.adsensePublisherId.trim();
    return { settings: merged, degraded: false };
  } catch {
    return { settings: DEFAULT_MONETIZATION, degraded: true };
  }
}

/** Effective global monetization settings (defaults + admin overrides). */
export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  return (await readMonetizationSettings()).settings;
}

/** Admin: persist the global monetization switches. */
export async function setMonetizationSettings(s: MonetizationSettings): Promise<void> {
  const db = createAdminClient();
  await db.from("settings").upsert({ key: "monetization", value: s }, { onConflict: "key" });
  cache = null;
}
