import { getAdsForZone } from "@/lib/monetization/ads";
import { parseHilltopTag, parseHilltopVastUrl } from "@/lib/monetization/hilltop";
import {
  DEFAULT_HILLTOP_ZONE_SOURCE,
  hilltopZoneSource,
} from "@/lib/monetization/hilltop-config";
import {
  exoClickZoneEnabled,
  getMonetizationSettings,
  resolveExoClickZoneId,
  type MonetizationSettings,
} from "@/lib/monetization/settings";
import type { AdSlotData } from "@/lib/monetization/types";
import { exoClickVastUrl } from "@/lib/monetization/vast";

/**
 * How a placement ZONE becomes a servable ad — the rules /api/ads,
 * /api/ads/exoclick and /api/ads/inventory all share.
 *
 * Moved out of app/api/ads/route.ts unchanged (2026-10-05) so the inventory
 * endpoint can ask "would this zone serve anything?" by running the SAME code
 * the real request runs, instead of a second copy of these rules that would
 * drift — a route file cannot export helpers, so they had to live here.
 */

/**
 * The global network/format toggles, so an admin can disable a whole network or
 * unit type without editing every row.
 *
 * The `popunder` switch is the gate for click-hijacking units. Unlike the
 * original it defaults OFF, so a pop row serves nothing until an operator
 * deliberately enables it.
 */
export async function allowedFilter(): Promise<(a: AdSlotData, zone: string) => boolean> {
  const settings = await getMonetizationSettings();
  return (a: AdSlotData, zone: string) => {
    const net = a.network.toLowerCase();
    if (!settings.adsense && net.includes("adsense")) return false;
    if (!settings.adsterra && net.includes("adsterra")) return false;
    if (!settings.propellerads && net.includes("propeller")) return false;
    /*
      The interstitial switch gates the full-screen PLACEMENTS, not just the
      `video` format.

      It previously only blocked `video`, so a display unit on the idle or
      after-download placement served even with the switch off — while the
      component's own documentation claimed the gate was server-side. The
      inverse also bit: with the switch off (its default) a correctly configured
      interstitial looked broken for a reason nothing surfaced.
    */
    if (!settings.interstitial && INTERSTITIAL_ZONES.has(zone)) return false;
    if (!settings.interstitial && a.format === "video") return false;
    // Off by default — a pop row serves nothing until deliberately enabled.
    if (!settings.popunder && a.format === "pop") return false;
    /*
      ExoClick: the master switch AND this zone's own switch, both of which must
      be on. `exoClickZoneEnabled` owns that precedence so the two gates cannot
      disagree — see lib/monetization/settings.ts.

      Gated HERE, server-side, rather than in the component. A client-side check
      would still ship the zone id to every visitor and would be one `if` away
      from serving during an AdSense review, and the per-page split exists
      precisely so an AdSense reviewer never meets an ExoClick creative.
    */
    if (a.format === "exoclick" && !exoClickZoneEnabled(settings, zone)) return false;
    return true;
  };
}

/** Placements that take over the screen — gated by the `interstitial` switch. */
const INTERSTITIAL_ZONES: ReadonlySet<string> = new Set([
  "idle_interstitial",
  "download_complete",
  "exit_intent_popup",
]);

/**
 * The slot a SHARED ExoClick zone id produces for a placement with no ad row.
 *
 * Without this, shared mode would be inert: `AdSurface` and `AdSlot` render
 * nothing when this endpoint answers `null`, so "one id for all slots" would
 * still have required creating a row per slot — which is the work it exists to
 * remove.
 *
 * The id is a stable synthetic string rather than a row uuid, because there is
 * no row. Nothing dereferences it: `/api/track` stores it as an opaque label,
 * and the real accounting is ExoClick's own VAST pixels.
 */
function sharedExoClickSlot(zone: string, zoneId: string): AdSlotData {
  return {
    id: `exoclick-shared-${zone}`,
    zone,
    network: "exoclick",
    format: "exoclick",
    scriptCode: null,
    imageUrl: null,
    targetUrl: null,
    headline: null,
    width: null,
    height: null,
    adClient: null,
    // The zone id the client never sees — /api/ads/exoclick resolves it again
    // server-side. Carried here only so the slot is well-formed.
    adSlotId: zoneId,
    adLayout: null,
    skippable: true,
    skipAfterSeconds: 5,
  };
}

/**
 * Apply shared ExoClick mode to a zone's answer.
 *
 * Only fills a GAP — an explicit row always wins, which `resolveExoClickZoneId`
 * enforces — and only when the zone's own per-page switch is on, so the shared
 * id cannot reach a page the operator cleared for an AdSense review.
 */
export async function withSharedExoClick(
  zone: string,
  found: AdSlotData | null,
): Promise<AdSlotData | null> {
  /*
    🔴 An ExoClick row with NO zone id does not count as "found".

    It is a row that cannot possibly serve — `AdSlot` requires `adSlotId` to
    render the ExoClick branch — but as a truthy result it still WON the
    precedence check and blocked the shared id from filling the placement. The
    symptom is a zone that reports an ad and renders nothing, which is precisely
    the silent class this file keeps having to defend against. Found live on
    `landing_section_break`, where a half-configured row left the section-break
    slots blank while every other placement filled.

    Treating it as absent also matches `resolveExoClickZoneId`, which already
    falls through to the shared id on a blank row id — the two now agree.
  */
  if (found && !(found.format === "exoclick" && !found.adSlotId)) return found;
  const settings = await getMonetizationSettings();
  if (!exoClickZoneEnabled(settings, zone)) return null;
  const zoneId = resolveExoClickZoneId(settings, zone, null);
  return zoneId ? sharedExoClickSlot(zone, zoneId) : null;
}

/**
 * How long the wallpaper reward video must be watched.
 *
 * Owner, 2026-09-01: "remove the exoclick video for wallpaper download and use
 * hiltop vast video, and must be watched for 15seconds."
 *
 * ⚠️ This is a CEILING, not a floor, and the difference matters. The gate opens
 * at 15 seconds, or when the creative ends if it is shorter — `useAdGateCountdown`
 * takes the smaller of the two, on the owner's own earlier instruction
 * (2026-08-30: "to be skipable when the ad finishes in the ad network, admin
 * timer set up should only be a fallback"). Holding someone in front of a
 * finished, frozen video is the bug that rule exists to prevent, so a 9-second
 * creative still releases at 9 seconds rather than at 15.
 */
const HILLTOP_WALLPAPER_SKIP_SECONDS = 15;

/** The skip delay for every other Hilltop moment — the existing default. */
const HILLTOP_SKIP_SECONDS = 5;

/** Which HilltopAds placement switch governs which ad zone. */
/**
 * Zones where Hilltop REPLACES an existing row rather than filling a gap.
 *
 * Owner, 2026-09-01: "disable the exoclick ads generally and replace with hiltop
 * video slider and vast". Every zone the source map names is a zone Hilltop has
 * been given, so an ads-table row left behind on one must not keep winning —
 * that is what "replace" means, and it is reversible by setting that zone's
 * source to `off`.
 */
const HILLTOP_OVERRIDES = new Set(Object.keys(DEFAULT_HILLTOP_ZONE_SOURCE));

/** The fields every Hilltop slot shares. */
const HILLTOP_SLOT_BASE = {
  network: "hilltopads",
  imageUrl: null,
  targetUrl: null,
  headline: null,
  width: null,
  height: null,
  adClient: null,
  adSlotId: null,
  adLayout: null,
  skippable: true,
} as const;

/**
 * Serve HilltopAds on the three MOMENTS it has been given.
 *
 * | zone                | Hilltop source        | switch      |
 * |---------------------|-----------------------|-------------|
 * | `wallpaper_reward`   | VAST 3.0 tag          | `wallpaper` |
 * | `download_complete`  | VAST 3.0 tag          | `download`  |
 * | `idle_interstitial`  | inline video (slider) | `idle`      |
 *
 * Owner, 2026-09-01: "i want hiltop inline video and vast to be used as idle
 * interstilla and download completed trigger … video inline should be used as
 * idle interstilla, and the vast as the new download complete", and earlier
 * "remove the exoclick video for wallpaper download and use hiltop vast video".
 *
 * 🔴 RUNS BEFORE THE SHARED EXOCLICK FALLBACK. On `wallpaper_reward` there is no
 * ads-table row at all — its video came from `exoclickSharedZoneId` filling the
 * gap — so taking the gap first is what replaces it, WITHOUT touching the shared
 * id that still serves every other ExoClick zone.
 *
 * ⚠️ THIS GRANTS NOTHING. It supplies a video for the existing gates to play.
 * The reward is still decided by the server-verified reward session and the
 * watch is still measured by our own player — Hilltop has no rewarded product
 * and nothing here pretends otherwise.
 */
export async function withHilltopZone(
  zone: string,
  found: AdSlotData | null,
): Promise<AdSlotData | null> {
  const settings = await getMonetizationSettings();
  const source = hilltopZoneSource(settings.hilltop, zone);
  if (source === "off") return found;

  /*
    🔴 WHERE HILLTOP OVERRIDES AN EXISTING ROW, AND WHERE IT ONLY FILLS A GAP.

    `wallpaper_reward` has no ads-table row — its video came from
    `exoclickSharedZoneId` filling the gap — so Hilltop takes the gap and an
    explicit row would still win.

    `download_complete` and `idle_interstitial` DO have rows, and the owner asked
    for Hilltop to replace what is on those two moments (2026-09-01: "i want
    hiltop inline video and vast to be used as idle interstilla and download
    completed trigger … the vast as the new download complete"). So when the
    placement switch is on, Hilltop wins; when it is off, this returns `found`
    untouched and those moments behave exactly as they always did. The switch is
    the whole of the difference, which is what makes it reversible from the admin
    rather than by a deploy.
  */
  if (found && !HILLTOP_OVERRIDES.has(zone)) return found;

  /*
    THE IDLE MOMENT TAKES THE INLINE VIDEO, NOT THE VAST TAG (owner: "video
    inline should be used as idle interstilla, and the vast as the new download
    complete").

    Served as a `display` slot carrying the video-slider script, which
    `FullscreenInterstitial` renders inside a SANDBOXED IFRAME. That is not
    incidental here: an iframe is its own `window`, so the once-per-page-load
    guard in their loader (`init` returns if `window[globalNameLoaded]`) is
    scoped to that frame and the idle ad can fire on every idle moment instead
    of only the first.
  */
  if (source === "banner" || source === "slider") {
    /*
      A per-ZONE tag when one is pasted, else the shared banner tag. Same
      fallback the page placements use, so an operator can give a busy moment
      its own Hilltop zone — and its own capping and reporting — one at a time.
    */
    const tag = parseHilltopTag(
      source === "banner"
        ? settings.hilltopSnippets?.[zone] || settings.hilltopBannerSnippet
        : settings.hilltopVideoSliderSnippet,
    );
    if (!tag) return found;
    return {
      ...HILLTOP_SLOT_BASE,
      id: `hilltop-inline-${zone}`,
      zone,
      format: "display",
      scriptCode: `<script async referrerpolicy="no-referrer-when-downgrade" src="${tag.src}"></script>`,
      /*
        🔴 A RECTANGLE, NOT THE VIEWPORT (owner, 2026-09-01: "the video slider
        interstilla shouldn't show full screen because slider are rectangle, it
        should show the main size and blur the background … nothing renders on
        the video during interstilla but it show Hilltop mute button but a blank
        black screen").

        A slot with no declared size stretches to the frame it is given, and the
        frame here is the full-screen interstitial. The slider is not a
        full-screen product: stretched, it laid out to nothing and left exactly
        what the screenshot shows — a black sheet with their mute button, which
        is `position: fixed` inside the frame and so was the only thing left with
        a size of its own.

        300x250 is THEIR default, not a guess. From the same loader bundle:

            width:  function () { return +(this.settings.ads[0].iframeWidth  || 300) }
            height: function () { return +(this.settings.ads[0].iframeHeight || 250) }

        With a declared size the interstitial centres the unit on its own
        backdrop, which is the "main size and blur the background" asked for.
      */
      width: 300,
      height: 250,
      skipAfterSeconds: 5,
    };
  }

  const url = parseHilltopVastUrl(settings.hilltopVastUrl);
  if (!url) return found;
  return {
    ...HILLTOP_SLOT_BASE,
    id: `hilltop-vast-${zone}`,
    zone,
    format: "video",
    // The VAST endpoint the player calls. Same field an ads-table video row uses.
    scriptCode: url,
    skipAfterSeconds:
      zone === "wallpaper_reward" ? HILLTOP_WALLPAPER_SKIP_SECONDS : HILLTOP_SKIP_SECONDS,
  };
}

/**
 * What /api/ads answers for ONE zone to a free (non-premium) visitor — exactly
 * the expression the route's single-zone and batch forms evaluate.
 */
export async function resolveSlotForFreeVisitor(zone: string): Promise<AdSlotData | null> {
  const allowed = await allowedFilter();
  const first = (await getAdsForZone(zone)).filter((a) => allowed(a, zone))[0] ?? null;
  return withSharedExoClick(zone, await withHilltopZone(zone, first));
}

/** The `?zone=global&all=1` form: every allowed page-level script row. */
export async function resolveGlobalScriptsForFreeVisitor(): Promise<AdSlotData[]> {
  const allowed = await allowedFilter();
  return (await getAdsForZone("global")).filter((a) => allowed(a, "global"));
}

/**
 * Where /api/ads/exoclick would START its VAST chain for a zone, or null when
 * it would answer `{ ad: null }` without fetching anything. Extracted from that
 * route (2026-10-05); it now calls this, so the two cannot disagree.
 */
export async function resolveVastSource(
  settings: MonetizationSettings,
  zone: string,
): Promise<{ adId: string; url: string; kind: "hilltop" | "exoclick" } | null> {
  const hilltopVast =
    hilltopZoneSource(settings.hilltop, zone) === "vast" ? parseHilltopVastUrl(settings.hilltopVastUrl) : null;
  if (hilltopVast) return { adId: `hilltop-vast-${zone}`, url: hilltopVast, kind: "hilltop" };
  if (!exoClickZoneEnabled(settings, zone)) return null;
  const row = (await getAdsForZone(zone)).find((a) => a.format === "exoclick" && a.adSlotId);
  const zoneId = resolveExoClickZoneId(settings, zone, row?.adSlotId ?? null);
  if (!zoneId) return null;
  return { adId: row?.id ?? `exoclick-shared-${zone}`, url: exoClickVastUrl(zoneId), kind: "exoclick" };
}
