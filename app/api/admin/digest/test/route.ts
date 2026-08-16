import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { buildDigest } from "@/lib/analytics/digest";
import { digestEmailHtml, digestEmailSubject } from "@/lib/analytics/digest-email";
import { alertsEnabled, sendAdminEmail } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ period: z.enum(["daily", "weekly", "monthly"]) });

/**
 * Admin-only "send now" button for the digest — verifies the whole pipeline
 * (aggregation → template → Resend) on demand, without waiting for the cron
 * or consuming its once-per-day dedupe lock (`sendAdminAlertOnce`'s
 * `admin_alerts` row), so testing today never blocks tonight's real send.
 */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid period." }, { status: 400 });

  if (!alertsEnabled()) {
    return NextResponse.json(
      { error: "Admin email isn't configured — set RESEND_API_KEY and ALERT_EMAIL_TO (or ADMIN_EMAILS)." },
      { status: 400 },
    );
  }

  try {
    const data = await buildDigest(parsed.data.period);
    const sent = await sendAdminEmail(`[TEST] ${digestEmailSubject(data)}`, digestEmailHtml(data));
    if (!sent) return NextResponse.json({ error: "Resend rejected the email — check server logs." }, { status: 502 });
    return NextResponse.json({ ok: true, metrics: data.metrics.length, warnings: data.warnings });
  } catch (err) {
    console.error("[digest/test] failed:", err);
    return NextResponse.json({ error: "Couldn't build or send the digest." }, { status: 500 });
  }
}
