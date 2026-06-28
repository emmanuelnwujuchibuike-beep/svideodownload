import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin email alerts via Resend's REST API (no SDK dependency). Dormant unless
 * configured, so it never breaks builds or local dev.
 *
 * Env (set on the Vercel frontend, where analytics/admin run):
 *   RESEND_API_KEY    – your Resend API key
 *   ALERT_EMAIL_TO    – comma-separated recipients (falls back to ADMIN_EMAILS)
 *   ALERT_EMAIL_FROM  – verified sender; defaults to Resend's onboarding address
 *                       (works out-of-the-box to your own Resend account email)
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
const FROM = process.env.ALERT_EMAIL_FROM?.trim() || "SVideoDownload <onboarding@resend.dev>";

function recipients(): string[] {
  const raw = process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function alertsEnabled(): boolean {
  return !!RESEND_API_KEY && recipients().length > 0;
}

/** Low-level send. Returns true on a 2xx from Resend. Never throws. */
export async function sendAdminEmail(subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn("[notify] RESEND_API_KEY not set — admin email skipped.");
    return false;
  }
  const to = recipients();
  if (to.length === 0) {
    console.warn(
      "[notify] No recipients — set ALERT_EMAIL_TO (or ADMIN_EMAILS). Admin email skipped.",
    );
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Surface the reason instead of failing silently. The most common cause is
      // using the default `onboarding@resend.dev` sender, which Resend only lets
      // deliver to the account owner's own email — set a verified ALERT_EMAIL_FROM.
      const body = await res.text().catch(() => "");
      console.error(
        `[notify] Resend rejected email (${res.status}) from="${FROM}" to=${to.join(",")}: ${body}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notify] Resend request failed:", err);
    return false;
  }
}

/**
 * Sends an alert at most once per `dedupeKey`, using a unique row in
 * `admin_alerts` as the lock. If the email fails to send the lock row is
 * removed so the alert can be retried later. Safe under concurrency — only the
 * request that wins the unique insert sends the email.
 */
export async function sendAdminAlertOnce(
  dedupeKey: string,
  kind: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!alertsEnabled()) return;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("admin_alerts")
      .insert({ key: dedupeKey, kind, subject });
    // Duplicate key (already alerted) or table missing → nothing to do.
    if (error) return;

    const sent = await sendAdminEmail(subject, html);
    if (!sent) {
      // Roll back the lock so a later event can retry this alert.
      await supabase.from("admin_alerts").delete().eq("key", dedupeKey);
    }
  } catch {
    /* alerts must never throw into the caller */
  }
}

/** Shared HTML shell so every alert email looks consistent and on-brand. */
export function alertEmailHtml(opts: {
  heading: string;
  intro: string;
  rows?: { label: string; value: string }[];
  footnote?: string;
}): string {
  const rows = (opts.rows ?? [])
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">${r.label}</td>` +
        `<td style="padding:6px 0;text-align:right;font-weight:600;font-size:14px">${r.value}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#0b0b0f;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#15151b;border:1px solid #26262e;border-radius:16px;overflow:hidden">
    <tr><td style="height:4px;background:linear-gradient(90deg,#2563eb,#22d3ee)"></td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 8px;color:#fff;font-size:20px">${opts.heading}</h1>
      <p style="margin:0 0 18px;color:#9ca3af;font-size:14px;line-height:1.5">${opts.intro}</p>
      <table role="presentation" width="100%" style="border-top:1px solid #26262e;color:#e5e7eb">${rows}</table>
      ${opts.footnote ? `<p style="margin:18px 0 0;color:#6b7280;font-size:12px">${opts.footnote}</p>` : ""}
    </td></tr>
  </table>
  <p style="text-align:center;color:#4b5563;font-size:11px;margin:16px 0 0">SVideoDownload · admin alert</p>
  </body></html>`;
}
