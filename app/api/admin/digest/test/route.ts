import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { buildDigest } from "@/lib/analytics/digest";
import { digestEmailHtml, digestEmailSubject } from "@/lib/analytics/digest-email";
import { alertsEnabled, diagnoseEmail, sendAdminEmail } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ period: z.enum(["daily", "weekly", "monthly"]) });

/**
 * Admin-only "Send digest now" — the real digest, on demand.
 *
 * ── 🔴 IT IS NOT A TEST SEND ────────────────────────────────────────────────
 * Owner, 2026-08-24: "when i send a digest email from admin dashboard manually
 * it should send the real dat and not test, test is when you do it from this
 * machine". This used to prefix the subject with "[TEST]", which made the one
 * button an admin can actually reach produce something they then had to
 * mentally discount — and made a real early send impossible. The figures were
 * always real; only the label claimed otherwise. The label is gone.
 *
 * It still does NOT consume the cron's once-per-day dedupe lock
 * (`sendAdminAlertOnce`'s `admin_alerts` row), so sending now never suppresses
 * tonight's scheduled digest. That is the one behaviour worth keeping: this is
 * "send it early", not "send it instead".
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
    const sent = await sendAdminEmail(digestEmailSubject(data), digestEmailHtml(data));
    if (!sent) {
      /*
        "Check server logs" is not an answer anyone can act on from a dashboard.
        `diagnoseEmail` already resolves the config and returns Resend's exact
        status and body; it just was not wired to anything. It performs one more
        real send, which is acceptable here because we are already on the
        failure path and the whole point of this button is to find out why.
      */
      const why = await diagnoseEmail();
      return NextResponse.json(
        {
          error: "Resend rejected the email.",
          from: why.from,
          to: why.recipients,
          status: why.status,
          resend: why.body ?? why.error,
          hint:
            why.from.includes("onboarding@resend.dev")
              ? "The default onboarding@resend.dev sender may only deliver to the Resend account owner's own address. Either sign the Resend account up with that recipient, or verify a domain and set ALERT_EMAIL_FROM."
              : "ALERT_EMAIL_FROM must be a sender on a domain verified in Resend.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, metrics: data.metrics.length, warnings: data.warnings });
  } catch (err) {
    console.error("[digest/test] failed:", err);
    return NextResponse.json({ error: "Couldn't build or send the digest." }, { status: 500 });
  }
}
