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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH ADS THIS VISITOR MAY SEE, BY PLAN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-02: "note all this ads should never show on pro and business
 * users, only a 5secs download completes on batch and high quality download
 * should show on pro user alone, no other ad apart from the 5secs download
 * complete hiltop vast video."
 *
 *   business → nothing, ever. Unchanged.
 *   pro      → the download-COMPLETION video only, and only for 5 seconds.
 *   free     → everything.
 *
 * ── 🔴 WHY THE DECISION IS MADE HERE AND NOT ON THE CLIENT ───────────────────
 *
 * `/api/ads/config` — the only other thing the interstitial reads — is served
 * `Cache-Control: public, max-age=60`, i.e. a SHARED cache. Putting a per-plan
 * value in it would hand one visitor's entitlement to the next, which for an
 * ads decision means either showing a paying member ads or silently switching
 * them off for everyone. This endpoint is `private, no-store` and already
 * resolves the session, so it is the only correct place for the rule.
 *
 * The client needs no copy of this policy: a refused zone answers `{ad: null}`,
 * which every caller already treats as "no fill" and fails open on.
 */
type AdPolicy = {
  allowed: (zone: string) => boolean;
  skipOverride: number | null;
  /**
   * May this visitor be offered an upgrade on the ad overlay?
   *
   * 🔴 FALSE FOR ANYONE WHO ALREADY PAYS. A Pro member does still see one ad —
   * the 5s completion video — and telling the person who bought Pro to "upgrade
   * to Pro" inside it would be the worst copy on the site. Decided here, with
   * the plan, rather than by the overlay guessing from the skip length.
   */
  offerUpgrade: boolean;
};

/**
 * The two moments that run AFTER the file is already saved.
 *
 * A Pro member is paying not to be interrupted; a short ad once the thing they
 * asked for is already in hand is the one placement that does not stand between
 * them and it. That is the whole reason this is the exception the owner carved.
 */
const COMPLETION_ZONES: ReadonlySet<string> = new Set(["download_complete", "batch_download_complete"]);

/** The owner's number for the Pro exception, and the only ad they ever see. */
const PRO_COMPLETION_SKIP_SECONDS = 5;

const ALLOW_ALL: AdPolicy = { allowed: () => true, skipOverride: null, offerUpgrade: true };
const ALLOW_NONE: AdPolicy = { allowed: () => false, skipOverride: null, offerUpgrade: false };

/** Same fast path as /api/ads: no auth cookie means no session, means free. */
async function adPolicyFor(request: Request): Promise<AdPolicy> {
  const cookies = request.headers.get("cookie") ?? "";
  if (!/(^|;\s*)sb-[^=]*-auth-token/.test(cookies)) return ALLOW_ALL;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const plan = await getUserPlan(user?.id);
    if (plan === "business") return ALLOW_NONE;
    if (plan === "pro") {
      return {
        allowed: (zone) => COMPLETION_ZONES.has(zone),
        skipOverride: PRO_COMPLETION_SKIP_SECONDS,
        // They already upgraded. Never sell Pro to a Pro member.
        offerUpgrade: false,
      };
    }
    return ALLOW_ALL;
  } catch {
    /*
      🔴 A FAILED PLAN LOOKUP MUST NOT BILL A SUBSCRIBER WITH AN AD. Showing an
      ad to someone who paid not to see one is the worst outcome available here,
      and it is worse than losing one free visitor's impression — so an unknown
      session is treated as free ONLY when there was no auth cookie at all
      (handled above). Reaching this catch means there WAS a session we could
      not resolve, so refuse.
    */
    return ALLOW_NONE;
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

  const policy = await adPolicyFor(request);
  if (!policy.allowed(zone)) return NextResponse.json({ ad: null });

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
        {
          ad: {
            ...creative,
            adId,
            zone,
            /*
              A plan-imposed hold, when there is one. Only Pro sets it, and it
              is the SHORTER 5s the owner specified — sent with the creative
              because this is the only per-visitor response in the chain (the
              shared public config cannot carry an entitlement).
            */
            ...(policy.skipOverride !== null ? { skipAfterSeconds: policy.skipOverride } : {}),
            offerUpgrade: policy.offerUpgrade,
          },
        },
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
