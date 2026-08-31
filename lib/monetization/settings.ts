import { createAdminClient } from "@/lib/supabase/admin";

import { AD_ZONES, isExoClickZone, type AdZoneId } from "./ad-schema";
import {
  DEFAULT_VAST_INTERSTITIAL,
  normalizeVastInterstitial,
  type VastInterstitialConfig,
} from "./vast-interstitial";
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
  /* ── Offerium (rewarded / offerwall) ──────────────────────────────────────
     Owner, 2026-08-23: "put a slot in admin dashboard where I can set up all
     Offerium API, SDK, and all."

     🔴 PUBLIC CONFIG ONLY. Everything in this block is safe to reach a browser
     — an SDK URL and the ids that identify the publisher/placement are sent to
     the ad network by the client anyway, so they are not secrets.

     The SECRETS — the API key and the postback signing secret — deliberately do
     NOT live here and must never be added to this interface. This settings
     object is persisted in a database row an admin edits, and the fields chosen
     from it are served publicly by /api/ads/config; a signing secret in that
     path is a forged-reward primitive, because anyone holding it can mint a
     "reward completed" callback. They belong in server-only environment
     variables (OFFERIUM_API_KEY / OFFERIUM_POSTBACK_SECRET) read exclusively in
     server code — see lib/monetization/offerium.ts.

     ⚠️ NOT YET WIRED TO A LIVE INTEGRATION. These fields are the admin surface
     and the storage for it; no Offerium SDK is loaded and no postback is
     verified yet, because that requires Offerium's official publisher
     documentation (their exact SDK URL shape, callback parameters and signature
     scheme) which has not been supplied. Inventing an endpoint or a signature
     format would produce something that silently fails against the real
     service, so the integration point is left explicit and unbuilt rather than
     guessed. `offeriumConfigured()` below is what any future call site must
     gate on. */
  /** Master switch. Off = no Offerium code loads and no reward is offered. */
  offerium: boolean;
  /**
   * The SDK/script URL Offerium gives the publisher, pasted verbatim from their
   * dashboard. Stored rather than hard-coded so a change of SDK host or version
   * is an admin edit, not a deploy. Validated as an https URL before use.
   */
  offeriumSdkUrl: string;
  /** Public publisher/app identifier from the Offerium dashboard. */
  offeriumPublisherId: string;
  /** Public placement/zone identifier for the rewarded unit. */
  offeriumPlacementId: string;
  /**
   * What the admin wants to happen when Offerium is unavailable — it fails to
   * load, times out, or a reward cannot be verified. NEVER grants the reward:
   * "allow" means fall back to the normal, non-rewarded download rules for that
   * item, which is the safe default because a broken ad network must not lock a
   * visitor out of content they could otherwise have. "block" keeps the gate
   * closed and shows a retry.
   */
  offeriumFallback: "allow" | "block";

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
   * How many of a download's highest-quality format options (per media kind)
   * count as "top tier" for the reward-ad gate below — owner, 2026-08-16:
   * "the top 2 highest quality". Formats are already sorted best-first per
   * kind, so this is just how many leading entries count.
   */
  rewardTopTierCount: number;
  /**
   * Seconds a top-tier VIDEO download's reward ad must run before it unlocks
   * — owner: "All videos must show a 30 seconds ad to download the top 2
   * highest quality videos". Never skippable (`skipAfterSec` is always null
   * for this one, matching the existing size-gated first ad).
   */
  rewardVideoTopTierSeconds: number;
  /**
   * Seconds a top-tier IMAGE/AUDIO download's reward ad runs — owner: "image
   * and audio download shouldn't show 30 seconds reward ad… only a 5 sec ad
   * that can be skipped after 5sec". Distinct from the video duration because
   * the owner explicitly wants a shorter ad for these two kinds.
   */
  rewardImageAudioTopTierSeconds: number;
  /**
   * Seconds before the image/audio top-tier ad's Skip control appears.
   * Kept separate from the duration above so an admin can set, say, a longer
   * ad that's still skippable at 5s, without the two being forced equal.
   */
  rewardImageAudioSkipAfterSeconds: number;
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
  /**
   * Allow ExoClick units (the `exoclick` format) to serve.
   *
   * ── Defaults OFF, and that is the whole point of the switch ───────────────
   *
   * ExoClick's inventory skews adult, and this site has already been refused by
   * AdSense three times (see the low-value-content and YouTube-removal notes).
   * A reviewer who meets an ExoClick creative while the AdSense application is
   * open is a plausible fourth refusal, so the ExoClick zones ship WIRED AND
   * SEEDABLE but inert: an operator can paste every zone id in, look at the
   * admin, and still be serving nothing until this is deliberately turned on.
   *
   * ⚠️ Turning this on and leaving AdSense enabled runs both networks on the
   * same pages. That is a real risk to the AdSense account and it is the
   * operator's call to make knowingly — which is what this switch is for.
   */
  exoclick: boolean;
  /**
   * Per-zone ExoClick enablement, on top of the master switch above.
   *
   * ── Why both, rather than only one of them ────────────────────────────────
   *
   * They answer different questions. The master switch is "is this site running
   * ExoClick at all" — one place to stop the network dead without touching five
   * toggles or unseeding five zone ids. These are "and on which pages", which is
   * the question AdSense forces (owner, 2026-08-30: turn it off on the landing
   * where AdSense lives, keep it on Reels).
   *
   * Both must be true for a zone to serve, so the master stays a real kill
   * switch rather than a suggestion.
   *
   * Zones DEFAULT TO ON here, unlike the master. A missing key would otherwise
   * mean flipping the master on did nothing at all, which reads as broken — so
   * absence means enabled and these are an opt-OUT, while the master remains the
   * deliberate opt-in. See `normalizeExoClickZones`.
   */
  exoclickZones: Partial<Record<AdZoneId, boolean>>;
  /**
   * One ExoClick zone id used for EVERY ExoClick placement.
   *
   * Owner, 2026-08-30: "put a way i can select to use one ad zone id link for
   * all ad slots or not."
   *
   * Empty means off, and off is the default — placements then come from ad rows
   * as before, one row per zone. Set it and every built-in ExoClick placement
   * serves this id with no rows to create at all, which is the difference
   * between configuring five placements and configuring one.
   *
   * An explicit ad ROW always wins over this, so a single zone can still be
   * pointed somewhere else without abandoning the shared default.
   */
  exoclickSharedZoneId: string;
  /**
   * The ExoClick STICKY BANNER snippet, pasted from their dashboard.
   *
   * Deliberately its own field rather than an ad row (owner: "separate it
   * from other banners"). It is ExoClick's DISPLAY product and it places
   * ITSELF against the viewport, so it has no slot in the page layout and does
   * not belong in the zone registry, whose premise is where on the page a unit
   * goes. Parsed into `{ cls, zoneId }` at render time and emitted as a real
   * `<ins>` — the markup never reaches the DOM.
   */
  exoclickStickySnippet: string;
  /**
   * The ExoClick DISPLAY BANNER snippet for the bottom-nav bar.
   *
   * Owner, 2026-08-31: "configure the bottom nav to use this exoclick banner
   * link and separate it with others network banner like adsterra."
   *
   * Its own key, and that separation is the whole point: the bottom bar already
   * serves the `bottom_banner` AD ZONE, which is where the Adsterra row and
   * every other network row lives. Running an ExoClick `<ins>` through that
   * same zone would make the two networks compete for one slot, so an operator
   * could not have both. Same reasoning that gave the sticky and history
   * banners their own keys rather than a zone entry.
   */
  exoclickBottomNavSnippet: string;
  /**
   * The ExoClick OUTSTREAM VIDEO snippet for the history slot.
   *
   * Same `<ins>` mechanism as the sticky banner and a different product from
   * the five VAST zones: outstream is filled by ExoClick's own loader rather
   * than played by our `<video>`. It gets its own field because it is a
   * different zone with a different class — the owner's three ExoClick tags so
   * far are `eas6a97888e`, `eas6a97888e17` and `eas6a97888e37`, which is
   * exactly why none of this is hardcoded.
   */
  exoclickHistorySnippet: string;
  /** Full-screen VAST interstitial behaviour. See lib/monetization/vast-interstitial.ts. */
  vastInterstitial: VastInterstitialConfig;
  /**
   * Whether HD/top-tier downloads require a server-verified reward session at
   * all. Off skips the reward-session flow entirely — `preview-card.tsx` falls
   * back to the plain (still ad-gated-by-tier-and-duration) download.
   */
  rewardDownloadHdEnabled: boolean;
  /** Same switch for batch downloads. See `features/downloader/batch-ad-gate.tsx`. */
  rewardDownloadBatchEnabled: boolean;
  /**
   * Free-plan HD reward claims per day. `0` = unlimited (the starting value —
   * owner, 2026-08-16: "unlimited while testing, cap later"). Enforced
   * server-side via `lib/rate-limit.ts`'s `consumeDaily`, identical convention
   * to every other daily cap in this codebase (wallpapers, general downloads).
   */
  rewardHdDailyLimit: number;
  /** Free-plan batch reward claims per day. `0` = unlimited. */
  rewardBatchDailyLimit: number;
  /**
   * Whether the post-download "Review video" preview requires its own reward
   * session (GPT rewarded ad, owner 2026-08-16 spec) — a second, independent
   * monetization moment from the HD download unlock, never auto-chained to it.
   */
  rewardDownloadPreviewEnabled: boolean;
  /** Free-plan preview reward claims per day. `0` = unlimited. */
  rewardPreviewDailyLimit: number;
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
  /* Offerium ships OFF and unconfigured. It stays off until an admin pastes
     real values AND the server-side secrets exist — see `offeriumConfigured`. */
  offerium: false,
  offeriumSdkUrl: "",
  offeriumPublisherId: "",
  offeriumPlacementId: "",
  offeriumFallback: "allow",
  affiliates: true,
  recommendedTools: true,
  interstitial: false,
  interstitialSkipSeconds: 5,
  interstitialWallpaper: false,
  interstitialHistoryVideo: false,
  interstitialBatchDownload: false,
  batchGateSeconds: 30,
  batchCompleteSeconds: 5,
  rewardTopTierCount: 2,
  rewardVideoTopTierSeconds: 30,
  rewardImageAudioTopTierSeconds: 5,
  rewardImageAudioSkipAfterSeconds: 5,
  popunder: false,
  // Off until deliberately enabled — see the field's note for why.
  exoclick: false,
  /*
    Empty, which means every zone is ON — see `normalizeExoClickZones`. Nothing
    serves regardless while the master switch above is false, so the effective
    default is still "ExoClick renders nowhere".
  */
  exoclickZones: {},
  // Empty = off. Per-zone ad rows are the default arrangement.
  exoclickSharedZoneId: "",
  exoclickStickySnippet: "",
  exoclickBottomNavSnippet: "",
  exoclickHistorySnippet: "",
  vastInterstitial: DEFAULT_VAST_INTERSTITIAL,
  rewardDownloadHdEnabled: true,
  rewardDownloadBatchEnabled: true,
  rewardHdDailyLimit: 0,
  rewardBatchDailyLimit: 0,
  rewardDownloadPreviewEnabled: true,
  rewardPreviewDailyLimit: 0,
};

/**
 * Keep only known ExoClick zone keys, with real booleans.
 *
 * A stored blob can carry a zone that has since been removed, or a value that is
 * a string because some client posted `"false"` — which is truthy, and would
 * silently turn a placement the operator switched OFF back on. Both are dropped
 * rather than coerced.
 *
 * 🔴 Absence means ENABLED, which is the opposite of the usual fail-closed
 * instinct and is deliberate. This map is an opt-OUT layered under a master
 * switch that is itself opt-in: an unknown zone with the master ON should serve,
 * because the operator turning the master on is the act of consent, and a new
 * zone silently defaulting to off is the "I enabled it and nothing happened"
 * failure this codebase keeps having to diagnose.
 */
export function normalizeExoClickZones(value: unknown): Partial<Record<AdZoneId, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<AdZoneId, boolean>> = {};
  const declared = new Set<string>(AD_ZONES);
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // Any DECLARED zone, not just the five ExoClick shipped with — an operator
    // may place an ExoClick row anywhere, so a switch-off for any of them has
    // to survive a round trip. Unknown/removed zone ids are still dropped.
    if (!declared.has(key)) continue;
    if (typeof raw !== "boolean") continue;
    out[key as AdZoneId] = raw;
  }
  return out;
}

/**
 * May this ExoClick zone serve? The single answer both gates in one place.
 *
 * Exported so the serving route and any future caller cannot disagree about
 * precedence — the master switch wins, then the per-zone opt-out.
 */
export function exoClickZoneEnabled(
  settings: Pick<MonetizationSettings, "exoclick" | "exoclickZones">,
  zone: string,
): boolean {
  if (!settings.exoclick) return false;
  /*
    🔴 ANY zone, not just the five ExoClick shipped with (fixed 2026-08-30).

    This used to `return false` for any zone outside `EXOCLICK_ZONES`, which
    meant an ExoClick row placed on any OTHER placement served nothing at all —
    silently, with the row still reading "Live" in the admin and the master
    switch still on. It was reported within a day: a row on `result_top` (the
    one zone whose label contains the word "fetch") rendered nothing, and there
    was no surface anywhere saying why.

    The five zones are the ones with a purpose-built 9:16 slot in the page. They
    were never meant to be the only ones an operator may CHOOSE — `AdSlot`
    renders the ExoClick branch for whatever zone asks for it, so restricting it
    here made the admin offer a combination the renderer would honour and the
    server would drop.

    Per-zone opt-out still applies to every zone, so the AdSense-safety split is
    unchanged: `ZONE_SURFACE` classifies all of them, and the admin renders a
    switch for every zone that actually has an ExoClick row.
  */
  return settings.exoclickZones?.[zone as AdZoneId] !== false;
}

/**
 * Which ExoClick zone id serves this placement, if any.
 *
 * Precedence, and it only goes one way: an explicit ad ROW always wins. The
 * shared id is a DEFAULT for placements that have no row of their own, so
 * turning it on cannot silently repoint a placement someone deliberately
 * configured — and one zone can still be pointed elsewhere without giving up
 * the shared default everywhere else.
 *
 * The shared id only applies to the placements built for a 9:16 video unit. A
 * blanket "every zone" would drop a vertical video into the bottom banner and
 * the blog sidebar, which is not what "all ad slots" means.
 */
export function resolveExoClickZoneId(
  settings: Pick<MonetizationSettings, "exoclickSharedZoneId">,
  zone: string,
  rowZoneId: string | null | undefined,
): string | null {
  const explicit = (rowZoneId ?? "").trim();
  if (explicit) return explicit;
  const shared = (settings.exoclickSharedZoneId ?? "").trim();
  if (shared && isExoClickZone(zone)) return shared;
  return null;
}

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
    // Same reasoning as the three above: a stored blob can carry a removed zone
    // or a non-boolean, and a truthy `"false"` would turn a switched-off
    // placement back on.
    merged.exoclickZones = normalizeExoClickZones(merged.exoclickZones);
    // Clamped on READ as well as on write: a hand-edited blob must never reach
    // the player as a negative timeout or a 10-minute skip timer.
    merged.vastInterstitial = normalizeVastInterstitial(merged.vastInterstitial);
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
