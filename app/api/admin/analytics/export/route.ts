import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/export?range=24h|7d|30d&type=events|downloads
 * Streams a CSV report of the raw analytics rows for the range, as a file download.
 * Admin-guarded; capped so a huge window can't pull unbounded rows into memory.
 */
const MAX_ROWS = 50_000;

type ExportType = "events" | "downloads";

const COLUMNS: Record<ExportType, { table: string; timeCol: string; cols: string[] }> = {
  events: {
    table: "analytics_events",
    timeCol: "received_at",
    cols: ["received_at", "event_type", "visitor_id", "session_id", "path", "referrer", "country", "region", "city", "device", "browser", "os"],
  },
  downloads: {
    table: "analytics_downloads",
    timeCol: "created_at",
    cols: ["created_at", "updated_at", "platform", "media_kind", "quality", "status", "error_reason", "file_size", "duration_ms", "country", "device"],
  },
};

/**
 * Bot rows are excluded, so an export AGREES with the dashboard.
 *
 * The dashboard filters `is_bot`; this did not, so the CSV of the same range
 * would have contained more rows than the number on screen — and a spreadsheet
 * that disagrees with the dashboard is how people stop trusting both. Applied
 * with a tolerant fallback because the column only exists after migration 0115.
 */
const BOT_COLUMN = "is_bot";

function sinceIso(range: string): string {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * RFC-4180 cell, plus CSV-injection defense: `path`/`referrer` are visitor-supplied,
 * and a value starting with `= + - @` (or a tab/CR) is executed as a FORMULA when the
 * file is opened in Excel/Sheets. Prefix those with a `'` so the spreadsheet treats
 * the whole cell as text. Then quote when it contains a comma, quote, or newline.
 */
function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  const range = params.get("range") || "24h";
  const type: ExportType = params.get("type") === "downloads" ? "downloads" : "events";
  const spec = COLUMNS[type];
  const since = sinceIso(range);

  let rows: Record<string, unknown>[] = [];
  try {
    const db = createAdminClient();
    const query = () =>
      db
        .from(spec.table)
        .select(spec.cols.join(","))
        .gte(spec.timeCol, since)
        .order(spec.timeCol, { ascending: false })
        .limit(MAX_ROWS);

    const filtered = await query().eq(BOT_COLUMN, false);
    // Before migration 0115 the column does not exist and PostgREST errors.
    // Falling back keeps the export working rather than handing back an empty
    // file, which would read as "no traffic" instead of "not migrated yet".
    const { data } = filtered.error ? await query() : filtered;
    rows = (data ?? []) as unknown as Record<string, unknown>[];
  } catch {
    rows = [];
  }

  const header = spec.cols.join(",");
  const body = rows.map((row) => spec.cols.map((c) => csvCell(row[c])).join(",")).join("\n");
  const csv = `${header}\n${body}\n`;
  const filename = `frenz-analytics-${type}-${range}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
