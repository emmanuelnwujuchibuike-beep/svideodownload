/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT EACH PLAN ACTUALLY BUYS — one list, every surface
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "summary all the existing pro features on the upgrade card
 * not just ad free, so users see they can download in high quality, use AI, and
 * all, also all future features."
 *
 * The upgrade card used to say "ad-free library, more storage and faster
 * downloads" — one true line and one false one — while the pricing page carried
 * a carefully audited six-bullet list. Two hand-written lists of the same facts
 * is how one of them ends up wrong, so this module is the list and both read it.
 *
 * ── 🔴 EVERY LINE HAS A MECHANISM, AND TWO TEMPTING ONES ARE ABSENT ────────
 *
 * The pricing page's 2026-08-26 audit (its own docstring) established what is
 * and is not plan-gated, by reading the code rather than the last marketing
 * pass. Those findings are carried here verbatim in spirit, because they are
 * exactly the claims a "summarise all the Pro features" brief invites:
 *
 *   ❌ "Download in high quality / 4K"  — quality is NEVER plan-gated. The
 *      extractors and the download service serve the same formats to everyone.
 *      What Pro removes is the REWARD AD Free watches in front of a top-tier or
 *      100 MB+ file (lib/monetization/reward-policy.ts). That is the honest and
 *      still-compelling version, and it is the line below.
 *   ❌ "Unlock Frenz AI"               — AI is pay-per-generation for everyone;
 *      there is no plan gate on using it. What a site plan lifts is the AI
 *      CONCURRENCY (`lib/ai/policy.ts`: free `maxConcurrent: 1`, pro `2`,
 *      business `3`). So the line says that, and only that.
 *   ❌ "Faster / priority downloads"   — no speed or queue differentiation
 *      exists anywhere in the pipeline. The old card claimed it anyway.
 *
 * This project's standing rule is a real measured fact or nothing. A feature
 * list is the most expensive place to break it: somebody pays money for it.
 */

/** The Free tier, so "Everything in Free" above the Pro list is not a bare phrase. */
export const FREE_FEATURES: readonly string[] = [
  "Save from every supported platform",
  "HD video, MP3 audio & photos — no watermark",
  "Batch downloads — up to 3 links, 2 a day, with a short ad",
  "150 downloads/day",
  "5 GB private cloud storage",
  "API access — 50 requests a day",
  "Supported by ads",
];

/**
 * Pro, in full. Ordered by what a person actually feels, not by what is
 * cheapest to provide: the ad in front of a big file is the thing people hit.
 */
export const PRO_FEATURES: readonly string[] = [
  "Everything in Free",
  "No ads on downloads — skip the ad on large or top-quality files",
  "Batch downloads — up to 6 links, unlimited per day, no ad",
  "1,000 downloads/day",
  "50 GB private cloud storage",
  "Frenz AI — 2 generations running at once instead of 1",
  "API access — 500 requests a day",
];

export const BUSINESS_FEATURES: readonly string[] = [
  "Everything in Pro",
  "100% ad-free — every surface, including your download history",
  "Creator analytics — per-post views, engagement & audience growth",
  "10,000 downloads/day",
  "Unlimited private cloud storage",
  "Frenz AI — 3 generations running at once",
  "API access — 50,000 requests a day, the highest limit",
];

/**
 * The short form, for a card that has room for four lines rather than seven.
 *
 * 🔴 A SUBSET, never a rewrite. Each entry here is the same fact as its long
 * counterpart with the detail trimmed — so the card and the pricing page can
 * never promise different things, which is the whole reason this file exists.
 */
export const PRO_HIGHLIGHTS: readonly string[] = [
  "No ad before large or top-quality files",
  "Unlimited batch downloads, 6 links at a time",
  "1,000 downloads a day · 50 GB cloud storage",
  "Two Frenz AI generations at once",
];

/**
 * The forward-looking line the brief asks for ("also all future features").
 *
 * Deliberately a PROMISE ABOUT ACCESS, not about any particular feature: "and
 * everything we add to Pro next" is something the product can actually keep.
 * Naming an unbuilt feature here would be the same fabrication the absent
 * claims above were cut for.
 */
export const PRO_FUTURE_LINE = "…and everything we add to Pro next, included.";
