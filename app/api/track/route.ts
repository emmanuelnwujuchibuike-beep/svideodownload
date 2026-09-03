import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdClick, recordAdImpression, trackEvent } from "@/lib/analytics/events";
import { emit } from "@/lib/platform/event-bus";
import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { MONETAG_TRACK_SLOTS, isMonetagSlot } from "@/lib/monetization/monetag-track";
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
/*
  Derived, for the same reason the note at the top of this file gives: a
  hand-listed slot is silently dropped by `sendBeacon`, which surfaces no
  response, so a rejected Monetag slot would look exactly like a recorded one.
  MONETAG_TRACK_SLOTS comes from the format and moment registries themselves.
*/
const MONETAG_SLOTS = new Set<string>(MONETAG_TRACK_SLOTS);

const bannerSchema = z.object({
  kind: z.literal("banner"),
  slot: z.union([
    z.string().refine((v) => MONETAG_SLOTS.has(v)),
    z.enum([
    "sticky",
    "history",
    "historyfeed",
    "historyfallback",
    "hilltop_history",
    "hilltop_historyfeed",
    "hilltop_landing",
    "hilltop_feed",
    "historyfeedlastweek",
    "landing",
    "bottomnav",
    "interstitial",
  ])]),
  /** Did a creative actually arrive in the placeholder? */
  filled: z.boolean(),
  /**
   * A CLICK on the creative, rather than its arrival (owner, 2026-08-31: "the
   * ad activity in admin dashboard suppose to be impression and click").
   *
   * Optional so every existing beacon stays valid — `sendBeacon` gives no
   * response, so a schema change that rejected the old shape would silently
   * drop impressions, which is the exact failure the note below records.
   */
  click: z.boolean().optional(),
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
    const { slot, filled, path, click } = parsed.data;
    /*
      The fullpage interstitial is the same MECHANISM as the banners — an <ins>
      their loader fills — but it is not a banner, and an operator scanning the
      feed for "did the interstitial fire" should not have to read the slot
      column to tell them apart.
    */
    const isInterstitial = slot === "interstitial";
    /*
      A CLICK outranks the fill state it implies: you cannot click a creative
      that is not there, so a click beacon is reported as a click rather than as
      a second impression for the same placement.
    */
    const type = click
      ? (isInterstitial ? "interstitial_click" : "banner_click")
      : isInterstitial
        ? (filled ? "interstitial_filled" : "interstitial_empty")
        : (filled ? "banner_filled" : "banner_empty");
    trackEvent(type, {
      userId,
      metadata: { slot, path: path ?? null },
    });

    /*
      ═══════════════════════════════════════════════════════════════════════
       🔴 HILLTOP SLOTS ALSO COUNT AS REVENUE, NOT ONLY AS ACTIVITY
      ═══════════════════════════════════════════════════════════════════════

      Owner, 2026-09-02: "i want all vast information … and video slider to be
      reported in revenue and live activity."

      The banner beacon above writes the `events` feed and stops, which is why a
      Hilltop unit appeared in live activity and contributed nothing to the
      impression and click totals. `AdSlot` posts the OTHER shape (`kind:
      "impression"`), which is what makes those placements the only ones the
      revenue screen has ever counted.

      ⚠️ ONLY THE `hilltop_*` SLOTS. The ExoClick sticky / bottom-nav / history
      banners post this same shape and are deliberately left alone: they were
      never in the impression total, the owner did not ask for them, and
      silently folding them in would move a number they read daily for reasons
      that would not be visible anywhere. Adding them later is one line — and it
      should be a decision, not a side effect of this one.

      A `hilltop_*` slot carries no ads-table row (the tag comes from settings,
      not from `ads`), so `adId` is null and the zone string is the whole
      attribution — which is exactly how shared-mode ExoClick zones already
      record.
    */
    if (slot.startsWith("hilltop_")) {
      if (click) recordAdClick(slot, null, userId);
      // An EMPTY placement is not an impression. `filled` is the frame's own
      // painted height, so a no-fill records activity and no revenue — which is
      // the difference an operator is looking for when a zone under-earns.
      else if (filled) recordAdImpression(slot, null, userId);
    }

    /*
      ═══════════════════════════════════════════════════════════════════════
       MONETAG — every format and moment, counted only where it was OBSERVED
      ═══════════════════════════════════════════════════════════════════════

      Owner, 2026-09-03: "make all monetag ad slot and format shows the
      impression, click and interaction sections in the admin dashboard."

      Monetag's formats place themselves, usually into a cross-origin frame, so
      there is no publisher hook that reports an impression. What arrives here
      is therefore what the page could actually SEE happen:

        filled:false            we injected the loader. Activity only, and NOT
                                an impression — the denominator that makes a
                                format which is requested constantly and never
                                draws visible as the dead zone it is.
        filled:true             the network drew something real: a node it added
                                reached a usable size on screen
                                (features/monetization/network-ad-watch.ts).
        filled+click:true       a pointer landed on something it drew.

      ⚠️ MONETAG CLICKS ARE A LOWER BOUND, and the admin says so. A cross-origin
      frame swallows its own pointer events, so a click inside the creative
      never reaches this document. Undercounting is the honest direction here;
      the alternative — inferring a click from a tab losing focus — would put an
      invented numerator over a real denominator. Monetag's own dashboard stays
      the authority on billed clicks and revenue.

      Same shape as the hilltop_* branch above: no ads-table row exists for a
      settings-driven tag, so `adId` is null and the slot string is the whole
      attribution.
    */
    if (isMonetagSlot(slot)) {
      if (click) recordAdClick(slot, null, userId);
      else if (filled) recordAdImpression(slot, null, userId);
    }

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
