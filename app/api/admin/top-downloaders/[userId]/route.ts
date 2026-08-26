import { NextResponse } from "next/server";

import { fetchDownloaderDetail } from "@/lib/admin/downloader-detail";
import { getAdminUser } from "@/lib/admin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/top-downloaders/[userId] — full detail for ONE ranked
 * downloader: profile, streak, exact all-time count, day/week frequency,
 * platform/format breakdown, and their recent downloads.
 *
 * Owner, 2026-08-26: "signed in top downloader in live activity, should be
 * clickable to see full details of that users download, streaks, and how many
 * times a day or week and all information about that user."
 *
 * Admin-guarded; a non-admin never reaches another member's download history.
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  const detail = await fetchDownloaderDetail(userId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
}
