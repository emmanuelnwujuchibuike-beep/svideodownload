import { after, NextResponse } from "next/server";
import { z } from "zod";

import { geoFromHeaders, isBotUA, parseUA } from "@/lib/analytics/enrich";
import type { DownloadStatus } from "@/lib/analytics/types";
import { notifyAdminsOfDownloadOutcome } from "@/lib/analytics/download-failure-alert";
import { notifyAdminsOfRetrySuccess } from "@/lib/analytics/retry-success-alert";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.enum([
    "page_view",
    "page_exit",
    "session_start",
    "download_requested",
    "download_started",
    "download_preparing",
    "download_completed",
    "download_failed",
    "download_cancelled",
    "download_retried",
    "ad_impression",
    "ad_click",
    "reward_completed",
    // HD/batch reward-download funnel — see lib/analytics/types.ts.
    "download_hd_clicked",
    "download_hd_reward_started",
    "download_hd_reward_ready",
    "download_hd_reward_granted",
    "download_hd_reward_cancelled",
    "download_hd_reward_failed",
    "download_hd_authorized",
    "download_hd_started",
    "download_hd_completed",
    "download_hd_limit_reached",
    "download_batch_clicked",
    "download_batch_reward_started",
    "download_batch_reward_ready",
    "download_batch_reward_granted",
    "download_batch_reward_cancelled",
    "download_batch_reward_failed",
    "download_batch_authorized",
    "download_batch_started",
    "download_batch_completed",
    "download_batch_limit_reached",
    // The "Review video" GPT preview reward — see lib/analytics/types.ts.
    "download_preview_clicked",
    "download_preview_reward_started",
    "download_preview_reward_ready",
    "download_preview_reward_granted",
    "download_preview_reward_cancelled",
    "download_preview_reward_failed",
    "download_preview_authorized",
    "download_preview_opened",
    "download_preview_limit_reached",
    "custom",
  ]),
  visitorId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  occurredAt: z.number(),
  path: z.string().max(512).nullish(),
  referrer: z.string().max(1024).nullish(),
  downloadId: z.string().uuid().nullish(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.object({ events: z.array(eventSchema).max(50) });

const STATUS_FROM_TYPE: Partial<Record<string, DownloadStatus>> = {
  download_requested: "requested",
  download_started: "started",
  download_preparing: "preparing",
  download_completed: "completed",
  download_failed: "failed",
  download_cancelled: "cancelled",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 256) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * POST /api/analytics/collect — ingest a batch of client events.
 *
 * Idempotent: events are inserted with `on conflict (event_id) do nothing`, so a
 * refresh/retry replaying the same batch never double-counts. Download-lifecycle
 * events also upsert a canonical `analytics_downloads` row keyed by download_id, so
 * one download is one row no matter how many times its events arrive. Enriched
 * server-side with coarse geo + parsed device/browser/OS (never the raw IP), and the
 * user_id is attached from the session cookie when present. Always answers 204 —
 * analytics must never surface an error to the page.
 */
export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return new NextResponse(null, { status: 204 }); // malformed → drop quietly
  }
  if (parsed.events.length === 0) return new NextResponse(null, { status: 204 });

  // Best-effort identity + enrichment, shared across the batch.
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
  const geo = geoFromHeaders(request.headers);
  const uaRaw = request.headers.get("user-agent");
  const ua = parseUA(uaRaw);
  /*
    Automated traffic is MARKED, not dropped (owner audit, 2026-08-09).

    Nothing here used to look at the user agent, so every headless browser,
    synthetic monitor and preview fetcher that ran our JS was a visitor. Marking
    keeps the row queryable, so a mis-classification can be found and reversed;
    dropping would delete the evidence along with the noise. Every aggregate in
    migration 0115 filters `is_bot = false`.
  */
  const isBot = isBotUA(uaRaw);
  const nowIso = new Date().toISOString();

  /*
    Clamp the client's clock to ours.

    `occurredAt` is `Date.now()` on a device we do not control — a wrong system
    clock (or a trivially forged POST) could otherwise park events far in the
    future, where they would sit at the top of every "recent" query forever, or
    far in the past, where they would silently vanish from every range. The
    server's own `received_at` is authoritative for windowing; `occurred_at`
    stays useful for ordering within a batch, bounded to something sane.
  */
  const nowMs = Date.now();
  const occurredAtIso = (clientMs: number): string => {
    const bounded = Number.isFinite(clientMs)
      ? Math.min(Math.max(clientMs, nowMs - 24 * 3_600_000), nowMs)
      : nowMs;
    return new Date(bounded).toISOString();
  };

  const eventRows = parsed.events.map((e) => ({
    event_id: e.eventId,
    event_type: e.type,
    visitor_id: e.visitorId,
    session_id: e.sessionId,
    user_id: userId,
    download_id: e.downloadId ?? null,
    occurred_at: occurredAtIso(e.occurredAt),
    received_at: nowIso,
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    device: ua.device,
    browser: ua.browser,
    os: ua.os,
    is_bot: isBot,
    properties: e.properties ?? {},
  }));

  /*
    Canonical per-download rows.

    Within a batch the LATEST event by its own clock wins, not the last one in
    array order — and across batches the database enforces the same rule via
    `last_event_at` (migration 0115). That pairing is what fixed the status
    regression: the client re-queues a failed batch to the FRONT of the queue,
    so a retried batch is delivered after the batch behind it, and a plain
    "last write wins" upsert reverted completed downloads to 'requested' and
    nulled their file size.
  */
  const downloadRows = new Map<string, Record<string, unknown>>();
  for (const e of parsed.events) {
    const status = STATUS_FROM_TYPE[e.type];
    if (!status || !e.downloadId) continue;
    const p = e.properties ?? {};
    const eventAt = occurredAtIso(e.occurredAt);
    const existing = downloadRows.get(e.downloadId);
    if (existing && String(existing.last_event_at) > eventAt) continue;
    downloadRows.set(e.downloadId, {
      download_id: e.downloadId,
      visitor_id: e.visitorId,
      session_id: e.sessionId,
      user_id: userId,
      platform: str(p.platform),
      media_kind: str(p.mediaKind),
      quality: str(p.quality),
      status,
      error_reason: str(p.errorReason),
      file_size: num(p.fileSize),
      duration_ms: num(p.durationMs),
      retry_of: typeof p.retryOf === "string" ? p.retryOf : null,
      // Grouping keys for the admin outcome alert (migration 0137). Persisted
      // as well as read inline, because the ABANDONED sweep never sees an
      // event — it reads this table directly and has to group there too.
      batch_id: str(p.batchId),
      link_key: str(p.linkKey),
      country: geo.country,
      device: ua.device,
      is_bot: isBot,
      last_event_at: eventAt,
      updated_at: nowIso,
    });
  }

  try {
    const admin = createAdminClient();
    await admin.from("analytics_events").upsert(eventRows, { onConflict: "event_id", ignoreDuplicates: true });
    if (downloadRows.size > 0) {
      await admin.from("analytics_downloads").upsert([...downloadRows.values()], { onConflict: "download_id" });
    }
  } catch {
    /* the table may not be migrated yet, or a transient DB error — never error the client */
  }

  /*
    Admin alert on a bad outcome (owner, 2026-08-16: "Let admin receive push
    and email alert on failed, cancelled and abandoned Downloads").

    `after()`, not awaited inline — this fans out to push + email for every
    admin, and the visitor's own analytics beacon must not wait on any of that.
    A serverless function CAN freeze the instant its response is sent, so this
    has to be `after()` rather than a bare fire-and-forget call — the same
    reasoning `bumpDownloadsCount` in the post-download route documents (see
    the [[sw-swx-duplicate-const-bug]] project note: a bare `void` on its own
    never actually sent that one).

    Runs on the RAW `parsed.events`, not `downloadRows` — a batch can contain
    an EARLIER failed/cancelled event that a LATER event in the same batch
    superseded (e.g. a failure immediately followed by a successful retry
    using `retryOf`), and only `downloadRows`'s "latest wins" value would be
    checked if this read from there. The admin alert is about "did a failure
    happen", not "what is this download's current status" — those are
    different questions, and conflating them would silently swallow the
    interim failure a successful retry now covers up.
  */
  for (const e of parsed.events) {
    const status = STATUS_FROM_TYPE[e.type];

    /*
      A download that failed or was cancelled and then SUCCEEDED on a later
      attempt (owner, 2026-08-23). Sits in the same loop as the failure alert
      and for the same reason it reads `parsed.events` rather than
      `downloadRows`: this is about what HAPPENED, not about the download's
      final status, and "latest wins" would erase the interim history the alert
      is reporting on.

      `attempts` is sent by the client only on completion (features/downloads/
      manager.ts). Anything ≤ 1 is a first-time success — the normal case — and
      is filtered inside the alert so nobody is pushed for the thing that is
      supposed to happen.
    */
    if (status === "completed" && e.downloadId) {
      const p = e.properties ?? {};
      const attempts = typeof p.attempts === "number" ? p.attempts : 0;
      if (attempts > 1) {
        after(() =>
          notifyAdminsOfRetrySuccess({
            downloadId: e.downloadId!,
            attempts,
            platform: str(p.platform),
            mediaKind: str(p.mediaKind),
            userId,
          }),
        );
      }
    }

    if (status !== "failed" && status !== "cancelled") continue;
    if (!e.downloadId) continue;
    const p = e.properties ?? {};
    after(() =>
      notifyAdminsOfDownloadOutcome({
        downloadId: e.downloadId!,
        status,
        platform: str(p.platform),
        mediaKind: str(p.mediaKind),
        errorReason: str(p.errorReason),
        userId,
        visitorId: e.visitorId,
        device: ua.device,
        country: geo.country,
        batchId: str(p.batchId),
        linkKey: str(p.linkKey),
      }),
    );
  }

  return new NextResponse(null, { status: 204 });
}
