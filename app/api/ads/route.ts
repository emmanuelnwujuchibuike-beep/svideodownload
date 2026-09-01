import { NextResponse } from "next/server";

import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { getAdsForZone } from "@/lib/monetization/ads";
import { parseHilltopTag, parseHilltopVastUrl } from "@/lib/monetization/hilltop";
import { isHilltopPlacementOn } from "@/lib/monetization/hilltop-config";
import { getUserPlan } from "@/lib/monetization/plan";
import {
  exoClickZoneEnabled,
  getMonetizationSettings,
  resolveExoClickZoneId,
} from "@/lib/monetization/settings";
import type { AdSlotData } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Derived, never re-listed.

  This was a hand-maintained copy of the zone list, and it silently rejected
  every placement added after it was written — `/api/ads?zone=under_download`
  returned nothing, so the new units could never fill no matter what was seeded.
  `/api/track` had the same copy with the same gap, which would have lost their
  impressions too. Three lists, one of them right.
*/
const ZONES: ReadonlySet<string> = new Set<string>(AD_ZONES);

/**
 * Returns the ad(s) to render for a zone, or null/empty for premium users.
 * `?all=1` returns every active ad in the zone (used for page-level `global`
 * scripts like pop-unders / social bars); otherwise a single weighted slot.
 */
/**
 * Premium visitors never see ads. No session is treated as free.
 *
 * ── The fast path, which is the common one ────────────────────────────────────
 *
 * Resolving a plan costs `auth.getUser()` plus a plan lookup — two Supabase
 * round trips from Paris, on the request every ad on the page is waiting for.
 * The overwhelming majority of visitors to a downloader are signed out, and for
 * them the answer is knowable without asking anyone: no Supabase auth cookie
 * means no session, which means free.
 *
 * So the cookie is checked first and the round trips are skipped entirely when
 * it is absent. This is a LATENCY optimisation, not an authorisation one — a
 * forged cookie only causes the real check to run, and that check is unchanged.
 */
async function isPremium(request: Request): Promise<boolean> {
  const cookies = request.headers.get("cookie") ?? "";
  // Supabase SSR names its auth cookies `sb-<project-ref>-auth-token[.N]`.
  if (!/(^|;\s*)sb-[^=]*-auth-token/.test(cookies)) return false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return (await getUserPlan(user?.id)) !== "free";
  } catch {
    return false;
  }
}

/**
 * The global network/format toggles, so an admin can disable a whole network or
 * unit type without editing every row.
 *
 * The `popunder` switch is the gate for click-hijacking units. Unlike the
 * original it defaults OFF, so a pop row serves nothing until an operator
 * deliberately enables it.
 */
async function allowedFilter(): Promise<(a: AdSlotData, zone: string) => boolean> {
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
async function withSharedExoClick(
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
const HILLTOP_ZONE_PLACEMENT: Record<string, "wallpaper" | "download" | "idle" | undefined> = {
  wallpaper_reward: "wallpaper",
  download_complete: "download",
  idle_interstitial: "idle",
};

/**
 * Zones where Hilltop REPLACES an existing row rather than filling a gap.
 *
 * Only the two moments the owner asked it to take over. Everywhere else an
 * explicit ads-table row still wins, exactly as before.
 */
const HILLTOP_OVERRIDES = new Set(["download_complete", "idle_interstitial"]);

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
async function withHilltopZone(
  zone: string,
  found: AdSlotData | null,
): Promise<AdSlotData | null> {
  const placement = HILLTOP_ZONE_PLACEMENT[zone];
  if (!placement) return found;
  const settings = await getMonetizationSettings();
  if (!isHilltopPlacementOn(settings.hilltop, placement)) return found;

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
  if (zone === "idle_interstitial") {
    const tag = parseHilltopTag(settings.hilltopVideoSliderSnippet);
    if (!tag) return found;
    return {
      ...HILLTOP_SLOT_BASE,
      id: `hilltop-inline-${zone}`,
      zone,
      format: "display",
      scriptCode: `<script async referrerpolicy="no-referrer-when-downgrade" src="${tag.src}"></script>`,
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

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const zone = sp.get("zone") ?? "";
  const all = sp.get("all") === "1";

  /*
    Batch form: `?zones=a,b,c` returns `{ ads: { a: …, b: … } }`.

    Every placement used to fetch its own zone, so a downloader page made four
    or five separate round trips before any ad could paint — on a mobile
    connection that is most of the reason ads arrived after the visitor had
    already downloaded and left. One request answers the whole page.

    Deliberately capped: the parameter is attacker-controllable and each zone is
    a cache lookup, so an unbounded list would be a cheap way to make this
    endpoint do arbitrary work.
  */
  const batch = sp.get("zones");
  if (batch !== null) {
    const zones = batch
      .split(",")
      .map((z) => z.trim())
      .filter((z) => ZONES.has(z))
      .slice(0, 12);

    if (zones.length === 0) return NextResponse.json({ ads: {} }, { status: 400 });

    if (await isPremium(request)) {
      return NextResponse.json({ ads: Object.fromEntries(zones.map((z) => [z, null])) });
    }

    const allowed = await allowedFilter();
    const entries = await Promise.all(
      zones.map(
        async (z) =>
          [
            z,
            await withSharedExoClick(
              z,
              await withHilltopZone(
                z,
                (await getAdsForZone(z)).filter((a) => allowed(a, z))[0] ?? null,
              ),
            ),
          ] as const,
      ),
    );
    return NextResponse.json(
      { ads: Object.fromEntries(entries) },
      { headers: { "Cache-Control": "private, max-age=10" } },
    );
  }

  if (!ZONES.has(zone)) {
    return NextResponse.json(all ? { ads: [] } : { ad: null }, { status: 400 });
  }

  if (await isPremium(request)) return NextResponse.json(all ? { ads: [] } : { ad: null });

  const allowed = await allowedFilter();
  const ads = (await getAdsForZone(zone)).filter((a) => allowed(a, zone));
  const headers = { "Cache-Control": "private, max-age=10" };
  if (all) return NextResponse.json({ ads }, { headers });
  return NextResponse.json(
    { ad: await withSharedExoClick(zone, await withHilltopZone(zone, ads[0] ?? null)) },
    { headers },
  );
}
