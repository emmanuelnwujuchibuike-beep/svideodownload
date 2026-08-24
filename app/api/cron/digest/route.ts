import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { buildDigest, type DigestPeriod } from "@/lib/analytics/digest";
import { digestEmailHtml, digestEmailSubject } from "@/lib/analytics/digest-email";
import { alertsEnabled, sendAdminAlertOnce } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The admin digest sweep (owner, 2026-08-16: "a daily, weekly and monthly
 * total digest… sent to the admin email at the end of the day, week or
 * month (1am)").
 *
 * ── One cron slot, up to three emails ───────────────────────────────────────
 * This project is on a plan with a 2-cron limit and both slots are already
 * spent (`trending`, `profile-snapshots` — see the same note on
 * `abandoned-downloads/route.ts`). Rather than ask for a slot that doesn't
 * exist, this route fires ONCE a day and decides for itself which digest(s)
 * are due: the daily digest every run, the weekly digest when the run lands
 * on a Sunday, the monthly digest when the run lands on the last day of the
 * month. Intended schedule: `0 1 * * *` (1am UTC) — "1am" per the brief, in
 * UTC because nothing in this codebase carries a per-admin timezone and
 * inventing one for a single cron route would be a bigger change than the
 * digest itself. NOT registered in vercel.json for the reason above; trigger
 * it from an external scheduler (cron-job.org, a GitHub Actions schedule,
 * …) hitting this URL with the `CRON_SECRET` bearer header, or swap it in
 * for one of the two existing crons if this matters more than they do.
 *
 * ── Dedupe ───────────────────────────────────────────────────────────────
 * `sendAdminAlertOnce` locks on `admin_alerts.key` = `digest:<period>:<date>`,
 * so a retried or duplicated trigger within the same UTC day can never send
 * the same digest twice — the same mechanism `download-failure-alert.ts`
 * already uses for outcome alerts.
 */

function duePeriods(now: Date): DigestPeriod[] {
  const due: DigestPeriod[] = ["daily"];
  if (now.getUTCDay() === 0) due.push("weekly");
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (tomorrow.getUTCDate() === 1) due.push("monthly");
  return due;
}

async function sendOne(period: DigestPeriod, dateKey: string): Promise<void> {
  const data = await buildDigest(period);
  await sendAdminAlertOnce(`digest:${period}:${dateKey}`, "digest", digestEmailSubject(data), digestEmailHtml(data));
}

async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!alertsEnabled()) {
    return NextResponse.json({ ok: true, sent: [], note: "Admin email is not configured (RESEND_API_KEY / ALERT_EMAIL_TO)." });
  }

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const periods = duePeriods(now);

  const sent: DigestPeriod[] = [];
  for (const period of periods) {
    try {
      await sendOne(period, dateKey);
      sent.push(period);
    } catch (err) {
      console.error(`[digest] ${period} digest failed:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}

export const GET = run; // Vercel/external cron uses GET
export const POST = run; // manual trigger uses POST
