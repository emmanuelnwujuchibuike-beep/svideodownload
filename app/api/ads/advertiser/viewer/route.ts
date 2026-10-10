import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/advertiser/viewer → { admin: boolean }
 *
 * Owner, 2026-10-09: the "Sample data" label is hidden from an ADMIN viewing
 * their own dashboard, and only from them. The answer comes from the one
 * server-side admin check (profiles role/flag OR the ADMIN_EMAILS list) — the
 * database's is_admin() alone missed an admin by email. Called only when a
 * boosted campaign is on screen, so ordinary visits never reach it. No store:
 * the answer is per person.
 */
export async function GET() {
  const admin = await getAdminUser().catch(() => null);
  return NextResponse.json({ admin: !!admin }, { headers: { "cache-control": "private, no-store" } });
}
