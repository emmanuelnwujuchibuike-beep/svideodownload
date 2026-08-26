import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Push the admins when a download that had FAILED or been CANCELLED eventually
 * succeeded (owner, 2026-08-23: "if a particular download link was cancelled or
 * failed and retried and it succeeded, a push notification of 'Download
 * succeeded in 2 tries' should be sent to the admin").
 *
 * ── Why this is worth its own alert ───────────────────────────────────────────
 * `notifyAdminsOfDownloadOutcome` already reports failures, so an operator sees
 * the bad news. Without this they never see the resolution — every retried
 * download looks like a permanent failure in the inbox, which makes the failure
 * alerts progressively less trustworthy. "Succeeded on attempt 3" is also a
 * different and more actionable signal than either half alone: it says the
 * extractor is flaky for that platform rather than broken.
 *
 * ── Only ever fires for a REAL retry ──────────────────────────────────────────
 * Gated on `attempts > 1`. A first-time success is the normal case and pushing
 * on it would bury the operator in notifications for the thing that is supposed
 * to happen.
 *
 * ── Deduped, because the source can replay ────────────────────────────────────
 * `/api/analytics/collect` re-queues a failed batch to the FRONT of the client
 * queue, so the same completion event can legitimately arrive more than once —
 * the same reason `notifyAdminsOfDownloadOutcome` dedupes. `admin_alerts.key`
 * is UNIQUE (migration 0003), so the insert IS the lock rather than a
 * check-then-act race: whoever wins it sends, everyone else returns.
 *
 * Push only, no email: this is good news. The failure alert already emailed, so
 * a second inbox item saying "actually it worked" is noise on a channel that
 * needs to stay worth reading.
 *
 * Never throws — every channel is wrapped, so an alerting problem can never
 * turn into a failed analytics beacon.
 */
export interface RetrySuccessDetails {
  downloadId: string;
  /** Total attempts including the one that succeeded. Always > 1 here. */
  attempts: number;
  platform: string | null;
  mediaKind: string | null;
  userId: string | null;
}

export async function notifyAdminsOfRetrySuccess(d: RetrySuccessDetails): Promise<void> {
  if (!Number.isFinite(d.attempts) || d.attempts < 2) return;

  // One alert per download, whatever the batch replays.
  const dedupeKey = `download:retry-success:${d.downloadId}`;
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("admin_alerts")
      .insert({ key: dedupeKey, kind: "download_retry_success", subject: "Download succeeded after retry" });
    // Duplicate key (already alerted for this download) or the table isn't
    // migrated — either way there is nothing to do.
    if (error) return;
  } catch {
    return;
  }

  try {
    const adminIds = await resolveAdminUserIds();
    if (adminIds.length === 0) return;

    const tries = `${d.attempts} tr${d.attempts === 1 ? "y" : "ies"}`;
    const where = [d.platform, d.mediaKind].filter(Boolean).join(" · ");

    await Promise.all(
      adminIds.map((id) =>
        sendSmartPush(
          id,
          {
            title: `Download succeeded in ${tries}`,
            body: where || "A retried download completed.",
            url: `${SITE_URL}/admin`,
            tag: "download-retry-success",
          },
          // Resolution of a problem, not a problem — kept out of the
          // critical/high lanes the failure alerts use.
          "medium",
          "downloads",
          { type: "download_complete" },
        ).catch(() => {}),
      ),
    );
  } catch {
    /* push is best-effort */
  }
}
