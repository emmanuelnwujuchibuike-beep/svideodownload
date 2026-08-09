import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The admin download log — every user's downloads, successful and failed, with
 * the details and the source link (owner, 2026-08-09).
 *
 * ── Where the LINK comes from ────────────────────────────────────────────────
 * `analytics_downloads` has no URL column and never did — it was designed as a
 * counting table, so it stores platform and quality but not what was
 * downloaded. The source URL is carried instead on the `download_requested`
 * event's `properties`, and `analytics_download_log` (migration 0115) joins it
 * back per download.
 *
 * That join is exact for every download recorded after this shipped. For older
 * rows the property was never sent, so `sourceUrl` comes back NULL — reported as
 * "not recorded" in the UI rather than as a broken link or a guessed one.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────
 * `userId` is present for signed-in downloads and null for the signed-out
 * majority, which is most of this site's traffic. `visitorId` is the anonymous
 * per-device id, so a guest's downloads can still be grouped without ever
 * identifying the person behind them. Raw IPs are not stored anywhere in this
 * pipeline (0103), so there is nothing here that de-anonymises a visitor.
 */

export type Range = "24h" | "7d" | "30d";
export type DownloadLogStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "requested"
  | "started"
  | "preparing";

export interface DownloadLogRow {
  downloadId: string;
  status: string;
  platform: string | null;
  mediaKind: string | null;
  quality: string | null;
  fileSize: number | null;
  durationMs: number | null;
  errorReason: string | null;
  country: string | null;
  device: string | null;
  userId: string | null;
  visitorId: string;
  createdAt: string;
  updatedAt: string;
  /** Null for downloads recorded before the URL started being sent. */
  sourceUrl: string | null;
  title: string | null;
  /** Display handle/email for a signed-in downloader; null for guests. */
  userLabel: string | null;
}

export interface DownloadLog {
  rows: DownloadLogRow[];
  page: number;
  pageSize: number;
  /** True when another page exists (we fetch one extra row to find out). */
  hasMore: boolean;
  /** False when migration 0115 has not been applied — the log is unavailable, not empty. */
  available: boolean;
}

const PAGE_SIZE = 50;

function sinceIso(range: Range): string {
  const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

interface RpcRow {
  download_id: string;
  status: string;
  platform: string | null;
  media_kind: string | null;
  quality: string | null;
  file_size: number | null;
  duration_ms: number | null;
  error_reason: string | null;
  country: string | null;
  device: string | null;
  user_id: string | null;
  visitor_id: string;
  created_at: string;
  updated_at: string;
  source_url: string | null;
  title: string | null;
}

export async function getDownloadLog(opts: {
  range: Range;
  status: DownloadLogStatus | null;
  page: number;
}): Promise<DownloadLog> {
  const empty: DownloadLog = { rows: [], page: opts.page, pageSize: PAGE_SIZE, hasMore: false, available: false };
  try {
    const db = createAdminClient();
    // One extra row is the cheapest reliable "is there a next page" — a COUNT
    // over a filtered join costs far more than the single row it replaces.
    const { data, error } = await db.rpc("analytics_download_log", {
      p_since: sinceIso(opts.range),
      p_status: opts.status,
      p_limit: PAGE_SIZE + 1,
      p_offset: opts.page * PAGE_SIZE,
    });
    if (error) return empty;

    const raw = (data ?? []) as RpcRow[];
    const hasMore = raw.length > PAGE_SIZE;
    const page = raw.slice(0, PAGE_SIZE);

    /*
      Resolve signed-in downloaders to something an operator can read.

      One batched lookup for the whole page rather than a join in the RPC: the
      profile table lives outside the analytics schema, and keeping the RPC to
      analytics tables alone means it cannot be broken by a profile migration.
    */
    const userIds = [...new Set(page.map((r) => r.user_id).filter((v): v is string => !!v))];
    const labels = new Map<string, string>();
    if (userIds.length > 0) {
      try {
        // `handle` is the @-name column (0006_social_identity), not `username`.
        const { data: profiles } = await db
          .from("profiles")
          .select("id, handle, display_name")
          .in("id", userIds);
        for (const p of (profiles ?? []) as { id: string; handle: string | null; display_name: string | null }[]) {
          labels.set(p.id, p.display_name || (p.handle ? `@${p.handle}` : p.id.slice(0, 8)));
        }
      } catch {
        /* a missing profile must not blank the log — the id still shows */
      }
    }

    return {
      rows: page.map((r) => ({
        downloadId: r.download_id,
        status: r.status,
        platform: r.platform,
        mediaKind: r.media_kind,
        quality: r.quality,
        fileSize: r.file_size,
        durationMs: r.duration_ms,
        errorReason: r.error_reason,
        country: r.country,
        device: r.device,
        userId: r.user_id,
        visitorId: r.visitor_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        sourceUrl: r.source_url,
        title: r.title,
        userLabel: r.user_id ? (labels.get(r.user_id) ?? null) : null,
      })),
      page: opts.page,
      pageSize: PAGE_SIZE,
      hasMore,
      available: true,
    };
  } catch {
    return empty;
  }
}
