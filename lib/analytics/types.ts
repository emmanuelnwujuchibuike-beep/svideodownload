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
  | "ad_impression"
  | "ad_click"
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
