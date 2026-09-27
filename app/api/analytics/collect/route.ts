import { after, NextResponse } from "next/server";
import { z } from "zod";

import type { DownloadStatus } from "@/lib/analytics/types";
import { geoFromHeaders, parseUA } from "@/lib/analytics/enrich";
import { notifyAdminsOfDownloadOutcome } from "@/lib/analytics/download-failure-alert";
import { notifyAdminsOfRetrySuccess } from "@/lib/analytics/retry-success-alert";
import { checkGrowthMilestones } from "@/server/services/analytics";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analytics/collect — ADMIN ALERTS ONLY. This route no longer stores
 * anything.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT IT USED TO BE, AND WHY IT SHRANK (owner, 2026-09-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This was the ingest endpoint: every batched beacon from every visitor woke it
 * to insert rows into `analytics_events` and upsert `analytics_downloads`.
 * 22,121 events in seven days, each invocation also producing a request log
 * entry — and request log entries are what the Vercel Observability meter
 * counts. The rows were always going to Supabase; only the courier was billed.
 *
 * Migration 0172 gave the browser its own door (`track_events` /
 * `track_download_state`, `security definer`, identity from `auth.uid()`), so
 * `lib/analytics/ingest.ts` writes to Postgres directly and this route is off
 * the hot path entirely.
 *
 * ── 🔴 WHY IT STILL EXISTS AT ALL ───────────────────────────────────────────
 *
 * Three things genuinely cannot move to the browser, and deleting the route
 * would have silently deleted them:
 *
 *   1. "Let admin receive push and email alert on failed, cancelled and
 *      abandoned Downloads" (owner, 2026-08-16). Push and email are sent with
 *      server credentials.
 *   2. The retry-success alert (owner, 2026-08-23) — a download that failed and
 *      then succeeded.
 *   3. The visitor/member growth milestone emails (owner, 2026-09-20).
 *
 * So the client calls this for TERMINAL DOWNLOAD EVENTS ONLY — failed,
 * cancelled, or completed after more than one attempt. That was 37 of the last
 * 1,000 events, ~3.7%, and it is the entire remaining Vercel cost of the event
 * pipeline.
 *
 * ── It is safe for this to fail ─────────────────────────────────────────────
 *
 * It writes nothing. By the time it is called the rows are already in Postgres,
 * so a failure here costs a notification, never data. That is why the client
 * fires it without awaiting the result.
 *
 * ── It still answers 204, always ────────────────────────────────────────────
 *
 * Analytics must never surface an error into the page that fired it.
 */

/**
 * Only the fields an ALERT needs.
 *
 * Deliberately far narrower than the old ingest schema, which had to validate
 * every event type in the product. This accepts download-lifecycle events and
 * nothing else, because nothing else can produce an alert — and a schema that
 * accepted more would invite a future writer to think this route still stores.
 */
const eventSchema = z.object({
  type: z.enum([
    "download_completed",
    "download_failed",
    "download_cancelled",
  ]),
  visitorId: z.string().min(1).max(64),
  downloadId: z.string().uuid(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.object({
  events: z.array(eventSchema).max(50),
  /*
    The client sets this. It is documentation rather than a gate — the narrowed
    schema above is what actually prevents this route being used as an ingest
    path again — but it makes a stray legacy caller obvious in a diff.
  */
  alertsOnly: z.literal(true).optional(),
});

const STATUS_FROM_TYPE: Partial<Record<string, DownloadStatus>> = {
  download_completed: "completed",
  download_failed: "failed",
  download_cancelled: "cancelled",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 256) : null;
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return new NextResponse(null, { status: 204 }); // malformed → drop quietly
  }
  if (parsed.events.length === 0) return new NextResponse(null, { status: 204 });

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

  for (const e of parsed.events) {
    const status = STATUS_FROM_TYPE[e.type];
    const props = e.properties ?? {};

    /*
      A download that failed or was cancelled and then SUCCEEDED on a later
      attempt (owner, 2026-08-23).

      `attempts` is sent by the client on completion only (features/downloads/
      manager.ts). Anything <= 1 is a first-time success — the normal case — and
      is filtered inside the alert as well, so nobody is pushed about the thing
      that is supposed to happen.
    */
    if (status === "completed") {
      const attempts = typeof props.attempts === "number" ? props.attempts : 0;
      if (attempts > 1) {
        after(() =>
          notifyAdminsOfRetrySuccess({
            downloadId: e.downloadId,
            attempts,
            platform: str(props.platform),
            mediaKind: str(props.mediaKind),
            userId,
          }),
        );
      }
      continue;
    }

    if (status !== "failed" && status !== "cancelled") continue;

    /*
      `after()`, not awaited inline — this fans out to push and email for every
      admin. A serverless function CAN freeze the instant its response is sent,
      so a bare `void` here would sometimes send nothing at all; that exact bug
      has been hit in this project before.
    */
    after(() =>
      notifyAdminsOfDownloadOutcome({
        downloadId: e.downloadId,
        status,
        platform: str(props.platform),
        mediaKind: str(props.mediaKind),
        errorReason: str(props.errorReason),
        userId,
        visitorId: e.visitorId,
        device: ua.device,
        country: geo.country,
        batchId: str(props.batchId),
        linkKey: str(props.linkKey),
      }),
    );
  }

  /*
    The visitor / member milestone emails (owner, 2026-09-20).

    ⚠️ THE SAMPLE RATE CHANGED WITH THE ROUTE'S TRAFFIC, ON PURPOSE. It was
    `< 0.02` — one batch in fifty — when this route saw every batch from every
    visitor. It now sees only terminal download events, roughly one call for
    every twenty-seven it used to get, so the old rate would have cut the check
    to near zero. 0.5 keeps the absolute frequency in the same range.
    `checkGrowthMilestones` throttles itself internally to one count per
    instance per ten minutes, so a higher rate here cannot become a query flood.

    The daily digest run checks every day regardless, so this is the early
    signal and not the guarantee.
  */
  if (Math.random() < 0.5) after(() => checkGrowthMilestones().catch(() => undefined));

  return new NextResponse(null, { status: 204 });
}
