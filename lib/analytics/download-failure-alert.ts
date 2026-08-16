import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Notify every admin — push AND email — when a download ends badly: failed,
 * cancelled, or abandoned (owner, 2026-08-16: "Let admin receive push and
 * email alert on failed, cancelled and abandoned Downloads").
 *
 * Reuses the exact fan-out `notifyAdminsOfSignIn` uses — `resolveAdminUserIds`
 * + `sendSmartPush` for push, `sendAdminEmail` + `alertEmailHtml` for email,
 * each in its own try/catch so one channel failing never blocks the other or
 * throws into the caller.
 *
 * ── Why this dedupes and sign-in alerts don't ───────────────────────────────
 * A sign-in is a single client action; this is fed from `/api/analytics/collect`,
 * whose own docstring explains that a retried BATCH can replay an event the
 * server already saw (the client re-queues a failed batch to the front of the
 * queue). Without a guard, one real failed download could alert the admin two
 * or three times as its terminal event gets redelivered. `admin_alerts.key` is
 * UNIQUE (migration 0003), so the insert below is the dedupe lock itself, not
 * a check-then-act race — reused as the existing "record each admin alert
 * exactly once" ledger, same table `sendAdminAlertOnce` writes to, just with
 * the insert done directly so this function can see whether it actually won
 * the lock (needed to gate BOTH channels, not only email).
 */
export interface DownloadOutcomeDetails {
  downloadId: string;
  status: "failed" | "cancelled" | "timed_out";
  platform: string | null;
  mediaKind: string | null;
  errorReason: string | null;
  userId: string | null;
  visitorId: string;
  device: string | null;
  country: string | null;
}

const OUTCOME_LABEL: Record<DownloadOutcomeDetails["status"], string> = {
  failed: "Download failed",
  cancelled: "Download cancelled",
  // The schema/type only ever declared "timed_out" (see analytics_downloads'
  // own comment: "…completed | failed | cancelled | timed_out | expired") —
  // this is the technical value the abandoned-download sweep writes; the
  // admin-facing word is the owner's own ("abandoned").
  timed_out: "Download abandoned",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function notifyAdminsOfDownloadOutcome(d: DownloadOutcomeDetails): Promise<void> {
  // One alert per (download, outcome) — see the module docstring for why a
  // duplicate delivery is a real, not hypothetical, case here.
  const dedupeKey = `download:${d.status}:${d.downloadId}`;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("admin_alerts").insert({ key: dedupeKey, kind: "download_outcome", subject: OUTCOME_LABEL[d.status] });
    // Duplicate key (already alerted for this exact download+outcome) or the
    // table isn't migrated yet — either way, nothing to do.
    if (error) return;
  } catch {
    return;
  }

  const label = OUTCOME_LABEL[d.status];
  const where = d.country ? ` · ${d.country}` : "";
  const media = d.mediaKind ? ` · ${d.mediaKind}` : "";

  // Push to every admin.
  try {
    const adminIds = await resolveAdminUserIds();
    await Promise.all(
      adminIds.map((id) =>
        sendSmartPush(
          id,
          {
            title: label,
            body: `${d.platform ?? "Unknown platform"}${media}${where}${d.errorReason ? ` · ${d.errorReason}` : ""}`,
            url: `${SITE_URL}/admin`,
            tag: "download-outcome",
          },
          "high",
          "downloads",
        ).catch(() => {}),
      ),
    );
  } catch {
    /* push is best-effort */
  }

  // Email the admin inbox.
  try {
    await sendAdminEmail(
      `${label}: ${d.platform ?? "unknown platform"}`,
      alertEmailHtml({
        heading: label,
        intro:
          d.status === "timed_out"
            ? "A download sat unfinished long enough to count as abandoned — nobody ever reported success or failure for it."
            : `A visitor's download just ${d.status === "failed" ? "failed" : "was cancelled"}.`,
        rows: [
          { label: "Platform", value: esc(d.platform ?? "Unknown") },
          { label: "Media", value: esc(d.mediaKind ?? "—") },
          { label: "Reason", value: esc(d.errorReason ?? "—") },
          { label: "Visitor", value: esc(d.userId ?? d.visitorId) },
          { label: "Device", value: esc(d.device ?? "—") },
          { label: "Location", value: esc(d.country ?? "Unknown") },
          { label: "Download ID", value: esc(d.downloadId) },
        ],
        footnote: "FrenzSave · Download outcome alerts",
      }),
    );
  } catch {
    /* email is best-effort */
  }
}
