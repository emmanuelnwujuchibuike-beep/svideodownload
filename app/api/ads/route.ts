import { NextResponse } from "next/server";

import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { getAdsForZone } from "@/lib/monetization/ads";
import { getUserPlan } from "@/lib/monetization/plan";
import { getMonetizationSettings } from "@/lib/monetization/settings";
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
    return true;
  };
}

/** Placements that take over the screen — gated by the `interstitial` switch. */
const INTERSTITIAL_ZONES: ReadonlySet<string> = new Set([
  "idle_interstitial",
  "download_complete",
  "exit_intent_popup",
]);

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
      zones.map(async (z) => [z, (await getAdsForZone(z)).filter((a) => allowed(a, z))[0] ?? null] as const),
    );
    return NextResponse.json(
      { ads: Object.fromEntries(entries) },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  }

  if (!ZONES.has(zone)) {
    return NextResponse.json(all ? { ads: [] } : { ad: null }, { status: 400 });
  }

  if (await isPremium(request)) return NextResponse.json(all ? { ads: [] } : { ad: null });

  const allowed = await allowedFilter();
  const ads = (await getAdsForZone(zone)).filter((a) => allowed(a, zone));
  const headers = { "Cache-Control": "private, max-age=30" };
  if (all) return NextResponse.json({ ads }, { headers });
  return NextResponse.json({ ad: ads[0] ?? null }, { headers });
}
