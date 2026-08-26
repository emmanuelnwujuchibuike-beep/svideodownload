import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { resolveAdminUserIds } from "@/lib/support/chat";

/**
 * Push every admin when somebody installs the app (owner, 2026-08-23: "let a
 * push notification be sent to the admin on every install").
 *
 * Reuses the same fan-out `notifyAdminsOfSignIn` and
 * `notifyAdminsOfDownloadOutcome` use — `resolveAdminUserIds` + `sendSmartPush`
 * — so admin alerting stays one mechanism rather than three that drift.
 *
 * ── Push only, no email ───────────────────────────────────────────────────────
 * The owner asked for a push. An install is a good-news, high-frequency event,
 * and the download-failure alert emails because a failure is something an
 * operator may need to dig into later. There is nothing to investigate here, so
 * an inbox copy of every install would be noise that trains someone to filter
 * admin mail — which is how the alerts that DO matter get missed.
 *
 * ── No dedupe ledger, deliberately ────────────────────────────────────────────
 * `notifyAdminsOfDownloadOutcome` writes to `admin_alerts` because its source
 * (`/api/analytics/collect`) can replay a batch and re-deliver one real event.
 * This one is fed by the browser's `appinstalled` event, which fires once per
 * install in the page that observed it; there is no retry queue behind it. A
 * duplicate would need someone to genuinely install twice, which is a real
 * event an operator should see both times. Adding a ledger would also mean a
 * write per install for no benefit.
 *
 * Never throws — every channel is wrapped, so an alerting problem can never
 * turn into a failed beacon request.
 */
export interface InstallAlertDetails {
  /** "android" | "desktop" | "ios" | "ios-inapp", when the client reported one. */
  platform: string | null;
  /** The signed-in installer, if they had an account. Installing needs no login. */
  userId: string | null;
}

export async function notifyAdminsOfInstall(d: InstallAlertDetails): Promise<void> {
  try {
    const adminIds = await resolveAdminUserIds();
    if (adminIds.length === 0) return;

    // "Android", "Desktop" — the coarse bucket the client already sends. No
    // device model, no IP, no location: an install beacon carries none of that
    // and this alert must not become a reason to start collecting it.
    const where = d.platform ? d.platform.replace("ios-inapp", "iOS in-app").replace("ios", "iOS") : "Unknown platform";
    const who = d.userId ? "a signed-in member" : "a visitor";

    await Promise.all(
      adminIds.map((id) =>
        sendSmartPush(
          id,
          {
            title: "New app install",
            body: `${where} · installed by ${who}`,
            url: `${SITE_URL}/admin`,
            // A shared tag so a burst of installs collapses into one
            // notification on the lock screen instead of a stack of them.
            tag: "app-install",
          },
          // An install is good news, not an interruption — "medium" keeps it
          // out of the critical/high lanes reserved for failures and security.
          "medium",
          "downloads",
          // Stored so the operator finds it in the Notification Center too, not
          // only on whichever device happened to be unlocked.
          { type: "system" },
        ).catch(() => {}),
      ),
    );
  } catch {
    /* alerting is best-effort and must never affect the beacon */
  }
}
