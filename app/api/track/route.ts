import { NextResponse } from "next/server";
import { z } from "zod";

import { countAdImpression, recordAdClick, recordAdImpression, trackEvent } from "@/lib/analytics/events";
import { emit } from "@/lib/platform/event-bus";
import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Derived from the one registry, never re-listed here.

  This was a hand-maintained copy and it did not include any placement added
  after it was written. The failure was completely silent and specifically
  destroys the numbers this endpoint exists to produce: the beacon is sent with
  `navigator.sendBeacon`, which never surfaces a response, so a rejected zone
  looks exactly like a recorded one from the page's side. Every impression and
  click on a new placement would have been dropped, and the admin dashboard
  would have shown a confident zero.
*/
/**
 * The banner-lifecycle beacon (owner, 2026-08-31: "wire the bottom banner ad
 * activity to the admin live activity").
 *
 * A SEPARATE shape rather than a new `zone`, because ExoClick's display
 * banners deliberately are not AD_ZONES — sticky, history and bottomnav each
 * have their own settings key so ExoClick and Adsterra can run side by side
 * rather than competing for one placement (see exoclick-sticky.ts). Forcing
 * them through the zone enum would either fail validation, silently, exactly
 * as the shared-id bug below did, or require inventing zones that no operator
 * can configure.
 */
const bannerSchema = z.object({
  kind: z.literal("banner"),
  slot: z.enum(["sticky", "history", "bottomnav", "interstitial"]),
  /** Did a creative actually arrive in the placeholder? */
  filled: z.boolean(),
  /**
   * The finer-grained state, when the caller has one.
   *
   * "requested" is the row that answers the question neither of the others
   * can: whether the placement FIRED at all. A moment that never runs and one
   * the network declines are the same empty screen from the outside.
   */
  state: z.enum(["requested", "filled", "empty"]).optional(),
  /** WHY it was empty — an ExoClick refusal reads very differently from a timeout. */
  reason: z.enum(["no-ads", "timeout", "blocked", "ended"]).optional(),
  /** Which page it was on — "the history page in particular". */
  path: z.string().max(120).optional(),
});

const adSchema = z.object({
  kind: z.enum(["impression", "click"]),
  zone: z.enum(AD_ZONES),
  /*
    🔴 NOT `.uuid()` any more (2026-08-30).

    Shared-mode ExoClick slots have no ad ROW, so they carry a synthetic id
    (`exoclick-shared-<zone>`). That is not a uuid, so the whole payload
    failed validation and returned 400 — dropping the impression AND the
    zone with it. `sendBeacon` never surfaces a response, so this was exactly
    the silent, confident-zero failure the note above describes, reintroduced
    by a different field.

    Accepted as free text and narrowed below: a real row id is stored, and
    anything else records against the ZONE with a null id. Losing which row
    served is a rounding error; losing the impression is the whole number.
  */
  adId: z.string().max(80).nullable().optional(),
});

const schema = z.union([bannerSchema, adSchema]);

/** Beacon endpoint for ad impressions/clicks. Rate-limited to resist floods. */
export async function POST(request: Request) {
  const ip = clientId(request.headers);
  const { success } = await trackLimiter.limit(ip);
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anon */
  }

  /*
    The banner beacon records and returns — it has no ad ROW, no zone counter
    and no click to attribute. It exists purely so the operator feed can answer
    "was the loader asked, and did anything come back", which is otherwise
    invisible from outside the browser.
  */
  if (parsed.data.kind === "banner") {
    const { slot, filled, path, state, reason } = parsed.data;
    /*
      The fullpage interstitial is the same MECHANISM as the banners — an <ins>
      their loader fills — but it is not a banner, and an operator scanning the
      feed for "did the interstitial fire" should not have to read the slot
      column to tell them apart.
    */
    /*
      Count it in the real impression numbers too (owner, 2026-08-31: "bottom
      banner should count in ad impression"). These placements are not AD_ZONES
      — each has its own settings key so ExoClick and Adsterra can run side by
      side — but the impression they produce is an ordinary impression, and the
      dashboard total is wrong without it. Attributed to the zone that describes
      the same POSITION, which is what an operator reading the report means.

      Counter only: `banner_filled` below is the feed row, and it names the
      placement and the page rather than just a zone id.
    */
    const IMPRESSION_ZONE: Record<string, string> = {
      bottomnav: "bottom_banner",
      history: "history_above_grid",
      sticky: "global",
      interstitial: "idle_interstitial",
    };
    // Only a real render is an impression — never the ask.
    if (filled && state !== "requested") countAdImpression(IMPRESSION_ZONE[slot] ?? "global", userId);

    const isInterstitial = slot === "interstitial";
    const type = isInterstitial
      ? state === "requested"
        ? "interstitial_requested"
        : filled
          ? "interstitial_filled"
          : "interstitial_empty"
      : filled
        ? "banner_filled"
        : "banner_empty";
    trackEvent(type, {
      userId,
      metadata: { slot, path: path ?? null, reason: reason ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  const { kind, zone } = parsed.data;
  /*
    Only a real row id reaches storage — `ad_events.ad_id` references `ads.id`,
    so a synthetic label would either violate the constraint or pollute the
    per-row report with a value that resolves to nothing.
  */
  const raw = parsed.data.adId ?? null;
  const adId =
    raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      ? raw
      : null;
  if (kind === "impression") {
    recordAdImpression(zone, adId ?? null, userId);
  } else {
    recordAdClick(zone, adId ?? null, userId);
    // Domain event (in-process, fire-and-forget) — clicks only; impressions would flood.
    emit("ad.clicked", { zone, adId: adId ?? null });
  }

  return NextResponse.json({ ok: true });
}
