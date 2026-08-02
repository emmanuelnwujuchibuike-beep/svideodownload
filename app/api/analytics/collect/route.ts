import { NextResponse } from "next/server";
import { z } from "zod";

import { geoFromHeaders, parseUA } from "@/lib/analytics/enrich";
import type { DownloadStatus } from "@/lib/analytics/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventSchema = z.object({
  eventId: z.string().uuid(),
  type: z.enum([
    "page_view",
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
  const ua = parseUA(request.headers.get("user-agent"));
  const nowIso = new Date().toISOString();

  const eventRows = parsed.events.map((e) => ({
    event_id: e.eventId,
    event_type: e.type,
    visitor_id: e.visitorId,
    session_id: e.sessionId,
    user_id: userId,
    download_id: e.downloadId ?? null,
    occurred_at: new Date(e.occurredAt).toISOString(),
    received_at: nowIso,
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    device: ua.device,
    browser: ua.browser,
    os: ua.os,
    properties: e.properties ?? {},
  }));

  // Canonical per-download rows (last event in the batch wins for status).
  const downloadRows = new Map<string, Record<string, unknown>>();
  for (const e of parsed.events) {
    const status = STATUS_FROM_TYPE[e.type];
    if (!status || !e.downloadId) continue;
    const p = e.properties ?? {};
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
