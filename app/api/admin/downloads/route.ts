import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getDownloadLog, type DownloadLogStatus } from "@/lib/analytics/download-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/downloads — every user's download history, newest first.
 *
 * Owner, 2026-08-09: "Admin should be able to see all users failed and
 * Successful downloads history details and link in the admin dashboard."
 *
 * Query: `range` (24h|7d|30d), `status` (all|completed|failed|cancelled|…),
 * `page` (0-based). Admin-guarded; a non-admin never reaches the data.
 */
const STATUSES = new Set<string>([
  "completed",
  "failed",
  "cancelled",
  "requested",
  "started",
  "preparing",
]);

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const r = sp.get("range");
  const range = r === "7d" || r === "30d" ? r : "24h";
  const rawStatus = sp.get("status") ?? "all";
  const status: DownloadLogStatus | null = STATUSES.has(rawStatus) ? (rawStatus as DownloadLogStatus) : null;
  const page = Math.max(0, Math.min(500, Number(sp.get("page")) || 0));

  return NextResponse.json(await getDownloadLog({ range, status, page }));
}
