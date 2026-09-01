import { NextResponse } from "next/server";

import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { getAdsForZone } from "@/lib/monetization/ads";
import { parseHilltopVastUrl } from "@/lib/monetization/hilltop";
import { hilltopZoneSource } from "@/lib/monetization/hilltop-config";
import { getUserPlan } from "@/lib/monetization/plan";
import {
  exoClickZoneEnabled,
  getMonetizationSettings,
  resolveExoClickZoneId,
} from "@/lib/monetization/settings";
import { exoClickVastUrl, parseVast, vastWrapperUrl } from "@/lib/monetization/vast";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve one ExoClick VIDEO zone into a playable creative.
 *
 * ── Why this cannot happen in the browser ─────────────────────────────────────
 *
 * `s.magsrv.com/v1/vast.php` answers with `Content-Type: text/xml` and NO
 * `Access-Control-Allow-Origin` header (verified against the live endpoint), so
 * a `fetch()` from frenzsave.com is blocked before the response is readable.
 * The proxy is not a preference — it is the only way to read the document at
 * all. It also keeps an XML reader off the client bundle entirely.
 *
 * ── It is not an open proxy ───────────────────────────────────────────────────
 *
 * The caller passes OUR zone name (`result_top`), never an ExoClick zone id. The
 * id is looked up from the ad row server-side, so this endpoint can only ever
 * fetch a zone an admin has actually configured. Accepting `?idzone=` from the
 * client would have turned the site into a free, IP-laundering relay for
 * arbitrary ExoClick inventory.
 */

/** Wrapper chains are followed, but not indefinitely. */
const MAX_WRAPPER_DEPTH = 3;
const FETCH_TIMEOUT_MS = 5000;

const ZONES: ReadonlySet<string> = new Set<string>(AD_ZONES);

/** Same fast path as /api/ads: no auth cookie means no session, means free. */
async function isPremium(request: Request): Promise<boolean> {
  const cookies = request.headers.get("cookie") ?? "";
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
 * Fetch a VAST document AS THE VISITOR.
 *
 * The visitor's IP and User-Agent are forwarded, because ExoClick targets and
 * prices on both. Without them every request looks like one datacentre in
 * Paris (see the `cdg1` region note), which would mean wrong-geo creatives, a
 * collapsed CPM, and — since the impression is then attributed to that IP —
 * traffic that looks fraudulent from the network's side.
 */
async function fetchVast(url: string, request: Request): Promise<string | null> {
  const forwarded =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const ua = request.headers.get("user-agent") ?? "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/xml,text/xml,*/*",
        ...(ua ? { "User-Agent": ua } : {}),
        ...(forwarded ? { "X-Forwarded-For": forwarded, "X-Real-IP": forwarded.split(",")[0]!.trim() } : {}),
        ...(request.headers.get("accept-language")
          ? { "Accept-Language": request.headers.get("accept-language")! }
          : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // A timeout or a network error is "no ad", never a 500 — an ad must not be
    // able to take a page's own request down with it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const zone = new URL(request.url).searchParams.get("zone") ?? "";
  if (!ZONES.has(zone)) return NextResponse.json({ ad: null }, { status: 400 });

  if (await isPremium(request)) return NextResponse.json({ ad: null });

  const settings = await getMonetizationSettings();

  /*
    🔴 THIS ENDPOINT IS THE ONE THE VAST INTERSTITIAL ACTUALLY CALLS (owner,
    2026-09-01: "download complete doesnt trigger the video slider or vast").

    The HilltopAds resolver added for these moments lives in /api/ads, and the
    zones answered correctly there — but `requestVastInterstitial` does not use
    /api/ads. It fetches `/api/ads/exoclick?zone=…`, which resolves an ExoClick
    zone id and plays ExoClick's VAST. So the download-complete moment was still
    asking ExoClick for a video while every other surface had moved to Hilltop,
    and there was no error anywhere to say so.

    The endpoint is only "exoclick" in its path. What it really does is turn a
    ZONE into a playable VAST creative, and it follows wrappers to get there, so
    starting it from a Hilltop tag needs nothing more than a different first URL.

    Hilltop takes precedence when its placement switch owns the moment; otherwise
    every line below is exactly what it was, including the ExoClick per-zone
    switch — which is deliberately NOT consulted for Hilltop, since an operator
    turning ExoClick off on a page must not also silence the network replacing it.
  */
  const hilltopVast =
    hilltopZoneSource(settings.hilltop, zone) === "vast"
      ? parseHilltopVastUrl(settings.hilltopVastUrl)
      : null;

  let adId: string;
  let url: string;
  if (hilltopVast) {
    adId = `hilltop-vast-${zone}`;
    url = hilltopVast;
  } else {
    if (!exoClickZoneEnabled(settings, zone)) return NextResponse.json({ ad: null });

    /*
      An explicit row first, then the shared zone id as a fallback — the same
      precedence `resolveExoClickZoneId` applies everywhere, so a placement cannot
      resolve to one id here and a different one in /api/ads.
    */
    const row = (await getAdsForZone(zone)).find((a) => a.format === "exoclick" && a.adSlotId);
    const zoneId = resolveExoClickZoneId(settings, zone, row?.adSlotId ?? null);
    if (!zoneId) return NextResponse.json({ ad: null });
    adId = row?.id ?? `exoclick-shared-${zone}`;
    url = exoClickVastUrl(zoneId);
  }

  for (let depth = 0; depth <= MAX_WRAPPER_DEPTH; depth++) {
    const xml = await fetchVast(url, request);
    if (!xml) return NextResponse.json({ ad: null });

    const creative = parseVast(xml);
    if (creative) {
      return NextResponse.json(
        { ad: { ...creative, adId, zone } },
        // Never shared between visitors: the creative is targeted to this one,
        // and a cached VAST would also mean a reused impression pixel.
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const next = vastWrapperUrl(xml);
    if (!next) return NextResponse.json({ ad: null });
    url = next;
  }

  return NextResponse.json({ ad: null });
}
