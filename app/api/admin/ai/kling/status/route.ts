import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { klingStatus } from "@/lib/ai/kling/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * GET /api/admin/ai/kling/status — Part 8 §46 / §8. Admin-only: is the Kling
 * key accepted, and how many units are left. Creates no task and bills
 * nothing (see lib/ai/kling/account.ts). The key never leaves the server; the
 * answer carries only the verdict and the pack figures.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await klingStatus(), { headers: { "cache-control": "no-store" } });
}
