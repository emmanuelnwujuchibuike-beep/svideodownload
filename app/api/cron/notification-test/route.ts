import { NextResponse } from "next/server";

import { wallpaperReminderPush } from "@/lib/analytics/wallpaper-reminder";
import { cronAuthorized } from "@/lib/cron/auth";
import { hasWebPush, sendPushToUser } from "@/lib/push/web-push";
import { STREAK_REMINDER_BODY, STREAK_REMINDER_TITLE } from "@/lib/streaks/reminders";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notification smoke test — deliver every scheduled push to the admin's own
 * devices, on demand.
 *
 * ── 🔴 WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Every scheduled push in this product only fires when its real condition is
 * met, and those conditions are deliberately hard to reach: the streak
 * reminder needs someone who was active YESTERDAY, has NOT returned today, and
 * whose local clock is past 14:00; the wallpaper reminder needs a day with no
 * admin upload. That is correct behaviour and it makes the delivery path
 * almost impossible to exercise deliberately — so a broken one would surface
 * as silence, weeks later, and silence is exactly what a working system with
 * nothing to say looks like.
 *
 * `/api/push/test` cannot cover this: it needs a browser session, so no
 * scheduler or terminal can reach it, and it sends its own generic copy rather
 * than the notification being tested.
 *
 * ── 🔴 IT SENDS THE REAL COPY ───────────────────────────────────────────────
 * The payloads are imported from the modules that own them, never retyped.
 * A test of copy that is not the copy proves nothing about what will arrive.
 *
 * ── 🔴 IT REPORTS WHAT IT COULD NOT DO ──────────────────────────────────────
 * `resolveAdminUserIds()` resolves admins from `profiles.role = 'admin'` OR
 * `ADMIN_EMAILS`. In this deployment NO profile carries the admin role, so
 * admin push depends entirely on `ADMIN_EMAILS` being set — and `ALERT_EMAIL_TO`
 * does NOT stand in for it. When that is misconfigured this route answers
 * `admins: 0` and says so, instead of reporting a cheerful success for
 * notifications that reached nobody.
 *
 * POST /api/cron/notification-test           → every kind
 * POST /api/cron/notification-test?kind=streak
 */
const KINDS = ["streak", "wallpaper"] as const;
type Kind = (typeof KINDS)[number];

function payloadFor(kind: Kind) {
  /*
    🔴 `force` IS WHAT MAKES THIS VISIBLE. The service worker suppresses the
    system notification whenever a window is visible, because the in-app
    drop-down normally shows that event instead. A test push writes no
    `notifications` row, so without this flag a tester with the app open sees
    NEITHER — silence from a send Apple accepted with a 201. Requires SW v17.
  */
  if (kind === "streak") {
    return {
      title: STREAK_REMINDER_TITLE,
      body: STREAK_REMINDER_BODY,
      url: "/",
      // Distinct from the production tag so a test can never collapse over,
      // or be collapsed by, a real reminder sitting on the lock screen.
      tag: "streak-reminder-test",
      force: true,
    };
  }
  return { ...wallpaperReminderPush(), tag: "wallpaper-reminder-test", force: true };
}

async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasWebPush) {
    return NextResponse.json(
      { ok: false, error: "Push is not configured — VAPID keys are missing." },
      { status: 503 },
    );
  }

  const requested = new URL(request.url).searchParams.get("kind");
  const kinds: Kind[] =
    requested && (KINDS as readonly string[]).includes(requested) ? [requested as Kind] : [...KINDS];

  const admins = await resolveAdminUserIds();
  if (admins.length === 0) {
    return NextResponse.json({
      ok: false,
      admins: 0,
      sent: [],
      error:
        "No admin resolved, so nothing was sent. resolveAdminUserIds() needs profiles.role='admin' or ADMIN_EMAILS — ALERT_EMAIL_TO does not count.",
    });
  }

  // Count devices first: "sent" with zero subscriptions is the failure this
  // route exists to make visible.
  const db = createAdminClient();
  const { count: devices } = await db
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .in("user_id", admins);

  if (!devices) {
    return NextResponse.json({
      ok: false,
      admins: admins.length,
      devices: 0,
      sent: [],
      error: "Admin resolved but no device is subscribed — enable notifications in the app first.",
    });
  }

  const sent: Kind[] = [];
  const failed: { kind: Kind; error: string }[] = [];
  for (const kind of kinds) {
    try {
      await Promise.all(admins.map((id) => sendPushToUser(id, payloadFor(kind))));
      sent.push(kind);
    } catch (err) {
      failed.push({ kind, error: err instanceof Error ? err.message : "send failed" });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    admins: admins.length,
    devices,
    sent,
    ...(failed.length ? { failed } : {}),
    /*
      🔴 SAY WHAT "sent" MEANS. It means the push SERVICE accepted the message,
      not that a device displayed it. Apple returns 201 for endpoints belonging
      to installs that no longer exist, so a subscription list that has
      accumulated over weeks reports a perfect result while the phone in your
      hand shows nothing. That is not hypothetical — it happened on the first
      run of this route. Per-endpoint outcomes are in `push_delivery_log`.
    */
    note: `"sent" means the push service accepted it (Apple returns 201 even for endpoints from an uninstalled PWA). ${devices} subscription(s) on file; only the current install will display. Per-endpoint results are in push_delivery_log.`,
  });
}

export const GET = run;
export const POST = run;
