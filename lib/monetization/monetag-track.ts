import { MONETAG_AD_TYPES, MONETAG_PLACEMENTS, type MonetagAdType, type MonetagPlacementId } from "./monetag";

/**
 * The `/api/track` slot ids for Monetag, and what they honestly mean.
 *
 * Owner, 2026-09-03: "make all monetag ad slot and format shows the impression,
 * click and interaction sections in the admin dashboard."
 *
 * ── What can and cannot be counted here ───────────────────────────────────────
 *
 * Monetag's formats are SELF-PLACING: one loader script decides on its own when
 * and where to draw, usually into a cross-origin frame. So there is no publisher
 * hook that says "an impression happened", and the network's own dashboard stays
 * the authority on billed impressions, clicks and revenue.
 *
 * 🔴 That leaves exactly three things this app can observe first-hand, and it
 * reports those and nothing else:
 *
 *   REQUESTED  we injected the loader. Ours, certain, and useless on its own —
 *              but it is the denominator: a format that is requested a thousand
 *              times and never renders is a dead zone, and that is invisible
 *              without this row.
 *   RENDERED   the network actually drew something. Measured, not assumed: a
 *              node it added reached a real size on screen
 *              (features/monetization/network-ad-watch.ts). This is the only
 *              row counted as an IMPRESSION.
 *   INTERACTED a real pointer event landed on a node the network drew.
 *
 * ⛔ THERE IS NO CLICK ROW, AND ADDING ONE WOULD BE A LIE. A click on a
 * self-placing creative happens inside the network's own frame; the parent
 * document never sees it. Reporting "interacted" as a click would put an
 * invented numerator over a real denominator and produce a CTR nobody can
 * trace — the fabricated-statistic trap this project has already declined three
 * times, in the one screen where the temptation is highest. The admin table
 * therefore shows Monetag CTR as blank, not as zero and not as a guess.
 *
 * ── Derived from the registries, never re-listed ──────────────────────────────
 *
 * `/api/track` once kept a hand-maintained copy of its zone list and silently
 * dropped every placement added after it was written. `sendBeacon` surfaces no
 * response, so a rejected slot looks exactly like a recorded one. Both id sets
 * below come from `MONETAG_AD_TYPES` / `MONETAG_PLACEMENTS`, so a format or a
 * moment added there is reportable the same day.
 */

/** Slot id for one Monetag FORMAT (the site-level loaders). */
export function monetagFormatSlot(type: MonetagAdType | string): string {
  return `monetag_format_${type}`;
}

/** Slot id for one Monetag MOMENT placement. */
export function monetagMomentSlot(moment: MonetagPlacementId | string): string {
  return `monetag_moment_${moment}`;
}

/** Every Monetag slot id `/api/track` accepts, derived from the registries. */
export const MONETAG_TRACK_SLOTS: string[] = [
  ...MONETAG_AD_TYPES.map((t) => monetagFormatSlot(t.id)),
  ...MONETAG_PLACEMENTS.map((p) => monetagMomentSlot(p.id)),
];

/** Whether a slot string belongs to Monetag. The prefix is the whole contract. */
export function isMonetagSlot(slot: string): boolean {
  return slot.startsWith("monetag_");
}

/**
 * Operator-facing labels — SHORT.
 *
 * Owner, 2026-09-03: "the monetag ad stat description in the admin dashboard is
 * too long and not neccesary, just a monetag download complete or result or
 * ilde is enought, no need for . or / or , or any long description."
 *
 * These were built from the registry's own labels ("After a download
 * completes", "Rewarded (unlock HD / standard)") joined with an em dash. That
 * wording is right for a settings picker, where an operator is choosing, and
 * wrong for a dense table of counts, where the label is an identifier read at a
 * glance beside a number. Two or three words, no punctuation.
 *
 * Written out rather than derived: the registry's wording is a SENTENCE by
 * design, and any mechanical shortening of it — first clause, split on a
 * bracket — breaks the day somebody rephrases one.
 */
const SHORT_FORMAT: Record<string, string> = {
  multitag: "multitag",
  in_page_push: "in-page push",
  push_notification: "push",
  vignette_banner: "vignette",
  onclick_popunder: "popunder",
};

const SHORT_MOMENT: Record<string, string> = {
  download_complete: "download complete",
  fetch_result: "result",
  rewarded: "rewarded",
  interstitial: "interstitial",
  idle: "idle",
  return: "return",
  backswipe: "back swipe",
};

export const MONETAG_SLOT_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    MONETAG_AD_TYPES.map((t) => [
      monetagFormatSlot(t.id),
      `Monetag ${SHORT_FORMAT[t.id] ?? t.id.replace(/_/g, " ")}`,
    ]),
  ),
  ...Object.fromEntries(
    MONETAG_PLACEMENTS.map((p) => [
      monetagMomentSlot(p.id),
      `Monetag ${SHORT_MOMENT[p.id] ?? p.id.replace(/_/g, " ")}`,
    ]),
  ),
};
