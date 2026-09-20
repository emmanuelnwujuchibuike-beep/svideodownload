import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { getGrowthAlerts, setGrowthAlerts } from "@/lib/analytics/growth-alert-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only: the "🎉 N visitors / members" milestone emails — each interval
 * and its on/off switch (owner, 2026-09-20). The same shape as
 * /api/admin/download-alerts.
 */
const counter = z.object({ every: z.number().int().min(1).max(100_000_000), enabled: z.boolean() });
const schema = z.object({ visitors: counter, users: counter });

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getGrowthAlerts());
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Each milestone needs a whole number (1 or more) and an on/off switch." }, { status: 400 });
  try {
    await setGrowthAlerts(parsed.data);
    return NextResponse.json({ ok: true, ...parsed.data });
  } catch {
    return NextResponse.json({ error: "Couldn't save the milestone settings." }, { status: 500 });
  }
}
