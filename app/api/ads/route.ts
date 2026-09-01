import { NextResponse } from "next/server";

import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { getAdsForZone } from "@/lib/monetization/ads";
import { parseHilltopVastUrl } from "@/lib/monetization/hilltop";
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

/**
 * Serve the HilltopAds VAST tag as the wallpaper reward video.
 *
 * 🔴 RUNS BEFORE THE SHARED EXOCLICK FALLBACK, which is what "remove the
 * exoclick video for wallpaper download" means in practice. No ExoClick row
 * exists on this zone — its video came from `exoclickSharedZoneId` filling the
 * gap — so taking the gap first is what replaces it, and it does so WITHOUT
 * touching the shared id that still serves every other ExoClick zone.
 *
 * An explicit ads-table row still wins over both, exactly as before.
 *
 * ⚠️ THIS DOES NOT GRANT ANYTHING. It supplies a video for the existing gate to
 * play; the reward is still decided by the server-verified reward session, and
 * the watch is still measured by our own player. Hilltop has no rewarded product
 * and nothing here pretends otherwise.
 */
async function withHilltopWallpaperVast(
  zone: string,
  found: AdSlotData | null,
): Promise<AdSlotData | null> {
  if (found) return found;
  if (zone !== "wallpaper_reward") return null;
  const settings = await getMonetizationSettings();
  if (!isHilltopPlacementOn(settings.hilltop, "wallpaper")) return null;
  const url = parseHilltopVastUrl(settings.hilltopVastUrl);
  if (!url) return null;
  return {
    id: `hilltop-vast-${zone}`,
    zone,
    network: "hilltopads",
    format: "video",
    // The VAST endpoint the player calls. Same field an ads-table video row uses.
    scriptCode: url,
    imageUrl: null,
    targetUrl: null,
    headline: null,
    width: null,
    height: null,
    adClient: null,
    adSlotId: null,
    adLayout: null,
    skippable: true,
    skipAfterSeconds: HILLTOP_WALLPAPER_SKIP_SECONDS,
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
              await withHilltopWallpaperVast(
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
    { ad: await withSharedExoClick(zone, await withHilltopWallpaperVast(zone, ads[0] ?? null)) },
    { headers },
  );
}
