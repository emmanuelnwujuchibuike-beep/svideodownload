/**
 * The coarse category every event carries into `analytics_events.feature`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Owner, 2026-09-27: "Admin → Downloads … subscribe only to the relevant
 * download event stream … Avoid one global subscription that receives every
 * FrenzSave event."
 *
 * Supabase Realtime filters match ONE column with one simple operator. There is
 * no `event_type in (…)` and no prefix match, so "the download events" has to
 * exist as a single comparable value or the admin cannot ask for them without
 * receiving everything and discarding most of it — which is the firehose being
 * avoided.
 *
 * ── 🔴 DERIVED FROM THE NAME, NEVER A HAND-WRITTEN LIST ─────────────────────
 *
 * This project has been bitten three times by a hand-maintained copy of a set
 * that the real source of truth outgrew: `/api/track` had a hand-listed ad-zone
 * enum that silently dropped every placement added after it was written, the
 * Monetag slot list had the same defect, and three separate hand-written status
 * lists predated `finalizing` and stopped job polling mid-job.
 *
 * `AnalyticsEventType` has ~90 members and gains more most weeks. A lookup
 * table here would be that same defect with a new name: the failure mode is a
 * new AI event quietly classifying as `null` and never reaching the AI section,
 * which looks exactly like "nothing happened".
 *
 * So the prefixes ARE the rule. Every event in the union is already named for
 * the surface it belongs to, and `featureOf` reads that name. A genuinely new
 * surface adds one prefix here; a new event inside an existing surface adds
 * nothing at all.
 */

import type { AnalyticsEventType } from "./types";

/**
 * The categories an admin section can subscribe to.
 *
 * Kept short: the column is `text` capped at 32 characters by the ingest
 * function, and these values are compared by equality in a Realtime filter, so
 * they are wire format — renaming one orphans the rows already written with it.
 */
export type EventFeature = "traffic" | "downloads" | "ai" | "ads" | "pwa" | "perf";

export const EVENT_FEATURES: readonly EventFeature[] = [
  "traffic",
  "downloads",
  "ai",
  "ads",
  "pwa",
  "perf",
] as const;

/**
 * Prefix → feature, longest prefix first.
 *
 * ⚠️ ORDER MATTERS AND IS CHECKED BY A TEST. `download_` would otherwise
 * swallow nothing it should not today, but `audio_library_` sitting after
 * `audio_` (if one were ever added) would. The test asserts that no earlier
 * entry is a prefix of a later one's key, so a future addition cannot silently
 * shadow an existing rule.
 */
const PREFIXES: readonly (readonly [string, EventFeature])[] = [
  // ── Frenz AI. Each tool names itself, so a new tool is one line here. ──
  ["character_replace_", "ai"],
  ["lip_sync_", "ai"],
  ["text_to_audio_", "ai"],
  ["audio_library_", "ai"],
  ["voice_clone_", "ai"],

  // ── The downloader, including its reward funnels. ──
  //
  // `download_hd_reward_*` and `download_batch_reward_*` are deliberately
  // DOWNLOADS, not ads: they are steps in a download the visitor is trying to
  // complete, and an operator asking "what is happening to downloads" wants the
  // step where the unlock was abandoned. The ad itself is counted separately by
  // the `ad_`/`vast_` events fired alongside them.
  ["download_", "downloads"],
  ["multilink_", "downloads"],

  // ── Monetization. ──
  ["ad_", "ads"],
  ["vast_", "ads"],
  ["reward_", "ads"],
  ["banner_", "ads"],
  ["interstitial_", "ads"],
  ["monetag_", "ads"],

  // ── Install funnel and real-user performance. ──
  ["pwa_", "pwa"],
  ["perf_", "perf"],

  // ── Traffic. Last, because it is the least specific. ──
  ["page_", "traffic"],
  ["session_", "traffic"],
];

/**
 * The feature an event belongs to, or `null` when nothing claims it.
 *
 * `null` is a real answer, not a failure: `custom` genuinely has no surface, and
 * the 145,796 rows written before the column existed are legitimately
 * unclassified. The admin renders those as "unclassified" rather than inventing
 * a bucket for them — a guessed category is a fabricated stat.
 */
export function featureOf(type: AnalyticsEventType | string): EventFeature | null {
  for (const [prefix, feature] of PREFIXES) {
    if (type.startsWith(prefix)) return feature;
  }
  return null;
}

/** Every prefix rule, for the guard test. Not part of the runtime contract. */
export function __prefixRules(): readonly (readonly [string, EventFeature])[] {
  return PREFIXES;
}
