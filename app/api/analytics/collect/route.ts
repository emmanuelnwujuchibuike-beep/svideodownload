import { NextResponse } from "next/server";
import { z } from "zod";

import { geoFromHeaders, isBotUA, parseUA } from "@/lib/analytics/enrich";
import type { DownloadStatus } from "@/lib/analytics/types";
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

  return new NextResponse(null, { status: 204 });
}
