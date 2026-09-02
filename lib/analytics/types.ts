/**
 * Enterprise Analytics — shared event contract (Phase 1).
 *
 * Every event carries its OWN `eventId` (a client-generated UUID) which is the
 * primary key in `analytics_events`, so re-sending an event (a network retry, a
 * page refresh replaying a queued batch) is idempotent — inserted exactly once.
 */

export type AnalyticsEventType =
  | "page_view"
  /**
   * Emitted when a page is LEFT, carrying `properties.dwellMs` — the visible
   * time actually spent on it. Powers "Time on page"; see lib/analytics/client.
   */
  | "page_exit"
  | "session_start"
  | "download_requested"
  | "download_started"
  | "download_preparing"
  | "download_completed"
  | "download_failed"
  | "download_cancelled"
  | "download_retried"
  // VAST interstitial lifecycle (2026-08-30). Kept as distinct verbs rather
  // than reusing ad_impression, because the whole point is telling a request
  // apart from a start apart from a timeout.
  | "vast_requested"
  | "vast_loaded"
  | "vast_started"
  | "vast_completed"
  | "vast_skipped"
  | "vast_closed"
  | "vast_timeout"
  | "vast_error"
  /**
   * A rendition failed to decode and the player moved to the next one.
   *
   * Worth its own event rather than folding into `vast_error`: this is a
   * RECOVERED failure, and the two must be countable apart. A rise here means
   * the server is picking a codec this audience cannot play (which is exactly
   * how the WebM-over-MP4 selection bug hid — every iOS visitor silently lost
   * the impression and nothing was recorded at all), while `vast_error` still
   * means the ad was genuinely lost.
   */
  | "vast_media_fallback"
  /** The "Tired of ads? Go Pro" link on the ad overlay was tapped. */
  | "ad_upgrade_click"
  | "ad_impression"
  | "ad_click"
  /**
   * A rewarded ad watched to completion — the visitor actually earned the HD
   * unlock, as distinct from an impression (the ad was shown) or a skip.
   * Nothing emitted this before 2026-08-09, so "reward ads watched" had no
   * source at all.
   */
  | "reward_completed"
  /**
   * HD/batch reward-download lifecycle (owner, 2026-08-16 spec, Part 20) — the
   * production reward-session flow in lib/monetization/reward-sessions.ts.
   * Distinct from `reward_completed` above (the older, single wallpaper/
   * top-tier-ad "watched" signal): these track the whole funnel, including the
   * cases nothing tracked before — ad unavailable, cancelled, limit reached.
   */
  | "download_hd_clicked"
  | "download_hd_reward_started"
  | "download_hd_reward_ready"
  | "download_hd_reward_granted"
  | "download_hd_reward_cancelled"
  | "download_hd_reward_failed"
  | "download_hd_authorized"
  | "download_hd_started"
  | "download_hd_completed"
  | "download_hd_limit_reached"
  | "download_batch_clicked"
  | "download_batch_reward_started"
  | "download_batch_reward_ready"
  | "download_batch_reward_granted"
  | "download_batch_reward_cancelled"
  | "download_batch_reward_failed"
  | "download_batch_authorized"
  | "download_batch_started"
  | "download_batch_completed"
  | "download_batch_limit_reached"
  /**
   * The "Review video" preview reward (owner, 2026-08-16 GPT spec) — a
   * second, independent reward context from the HD/batch download unlock,
   * gating the existing post-download review player.
   */
  | "download_preview_clicked"
  | "download_preview_reward_started"
  | "download_preview_reward_ready"
  | "download_preview_reward_granted"
  | "download_preview_reward_cancelled"
  | "download_preview_reward_failed"
  | "download_preview_authorized"
  | "download_preview_opened"
  | "download_preview_limit_reached"
  /**
   * Multi-Link Batch Downloader funnel (spec §35).
   *
   * The CLIENT half — every step a person takes inside the panel, which the
   * server never sees: opening it, adding and removing sources, fetching one,
   * ticking a post, retrying a failure, tapping the upgrade CTA. The three
   * moments the SERVER decides (authorized / refused / started) are separate
   * events in `lib/platform/events-registry.ts`, emitted where the decision is
   * actually made rather than where the client claims it happened — same split
   * as the reward-session events above.
   *
   * The reward ad itself is NOT re-tracked here: a multi-link batch runs
   * through the same `BatchAdGate` → `useRewardSession` path as a single-link
   * one, so it already emits the `download_batch_reward_*` events above. A
   * parallel set would double-count the same ads.
   */
  | "multilink_opened"
  | "multilink_source_added"
  | "multilink_source_removed"
  | "multilink_source_fetched"
  | "multilink_source_fetch_failed"
  | "multilink_posts_discovered"
  | "multilink_post_selected"
  | "multilink_download_clicked"
  | "multilink_batch_completed"
  | "multilink_retry_used"
  | "multilink_zip_downloaded"
  | "multilink_limit_reached"
  | "multilink_upgrade_clicked"
  | "custom";

/** A download's lifecycle status, mirrored into `analytics_downloads.status`. */
export type DownloadStatus =
  | "requested"
  | "started"
  | "preparing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "expired";

/** One event as sent by the client. Server fills geo/device/user from the request. */
export interface AnalyticsEventInput {
  eventId: string;
  type: AnalyticsEventType;
  visitorId: string;
  sessionId: string;
  /** Client wall-clock time (ms since epoch). The server also stamps received_at. */
  occurredAt: number;
  path?: string | null;
  referrer?: string | null;
  /** For download-lifecycle events. */
  downloadId?: string | null;
  /** Event-specific fields (platform, status, quality, size, error_reason, …). */
  properties?: Record<string, unknown>;
}

/** The POST body of /api/analytics/collect — a batch of events. */
export interface CollectBody {
  events: AnalyticsEventInput[];
}
