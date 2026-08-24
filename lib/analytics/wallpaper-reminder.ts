import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Owner, 2026-08-16: "a daily reminder that triggers everyday by 10am and
 * sent to admin as push in app notification and email notifications that
 * when a wallpaper wasn't update everyday before 10am it should trigger and
 * send a premium reminder to upload daily wallpaper, but if a wallpaper was
 * uploaded before 10am it shouldn't trigger."
 *
 * Scoped to `source = 'admin'` uploads only — the curated library
 * (`lib/wallpapers-server.ts`, `wallpapers.source`), not member-shared
 * wallpapers. The ask is about the admin's own upload cadence; a member
 * sharing a wallpaper to the public library shouldn't quietly excuse the
 * admin from theirs.
 *
 * Reuses `alertEmailHtml` (the same branded card `signin-alert.ts` and
 * `download-failure-alert.ts` use) rather than the digest's own template —
 * this is a single fact, not a report, and consistency across every other
 * short admin alert is the more "premium" choice than a bespoke layout.
 */
export async function checkAndNotifyMissingDailyWallpaper(): Promise<{ notified: boolean; reason: string }> {
  const db = createAdminClient();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const { data, error } = await db
    .from("wallpapers")
    .select("id")
    .eq("source", "admin")
    .gte("created_at", startOfToday.toISOString())
    .limit(1);

  if (error) return { notified: false, reason: "wallpapers table unavailable" };
  if ((data ?? []).length > 0) return { notified: false, reason: "already uploaded today" };

  /*
    `sendAdminAlertOnce` is the dedupe backstop against a duplicated cron
    trigger within the same day; the meaningful gate already happened above
    (no wallpaper found).

    🔴 IT NOW REPORTS WHETHER RESEND TOOK IT. This used to discard the result
    and answer "reminder dispatched" unconditionally — which was false for
    every send while ALERT_EMAIL_FROM was malformed. "Dispatched" should mean
    dispatched; a rejection has to reach the caller or nobody learns of it.
  */
  const dateKey = startOfToday.toISOString().slice(0, 10);
  const outcome = await sendAdminAlertOnce(
    `wallpaper-reminder:${dateKey}`,
    "wallpaper_reminder",
    "No wallpaper uploaded today yet",
    alertEmailHtml({
      heading: "Today's wallpaper is still missing",
      intro: "No new wallpaper has been added to the curated library today. A fresh upload keeps the gallery and the landing page rotation feeling alive.",
      rows: [
        { label: "Checked as of", value: new Date().toUTCString() },
        { label: "Library", value: `${SITE_URL}/admin?section=wallpapers` },
      ],
      footnote: "FrenzSave · daily wallpaper reminder",
    }),
  );

  try {
    const adminIds = await resolveAdminUserIds();
    await Promise.all(
      adminIds.map((id) =>
        sendSmartPush(
          id,
          {
            title: "Today's wallpaper is missing",
            body: "No wallpaper uploaded yet today — add one to keep the library fresh.",
            url: `${SITE_URL}/admin?section=wallpapers`,
            tag: "wallpaper-reminder",
          },
          "high",
          "system",
        ).catch(() => {}),
      ),
    );
  } catch {
    /* push is best-effort */
  }

  const emailNote =
    outcome === "sent"
      ? "email sent"
      : outcome === "duplicate"
        ? "email already sent today"
        : outcome === "disabled"
          ? "email not configured"
          : "EMAIL REJECTED by Resend";
  // `notified` stays true when the push went out even if the email did not —
  // but it must never claim an email that Resend refused.
  return {
    notified: outcome !== "rejected",
    reason: `no admin wallpaper today — ${emailNote}`,
  };
}
