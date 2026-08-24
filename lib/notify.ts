import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin email alerts via Resend's REST API (no SDK dependency). Dormant unless
 * configured, so it never breaks builds or local dev.
 *
 * Env (set on the Vercel frontend, where analytics/admin run):
 *   RESEND_API_KEY    – your Resend API key
 *   ALERT_EMAIL_TO    – comma-separated recipients (falls back to ADMIN_EMAILS)
 *   ALERT_EMAIL_FROM  – verified sender, as `Name <you@your-domain.com>` or a
 *                       bare address. A NAME ON ITS OWN is not a valid sender
 *                       and Resend 422s it — `resolveAlertFrom` below salvages
 *                       that case rather than letting every email fail
 *                       silently. Unset defaults to Resend's onboarding
 *                       address, which only delivers to your own Resend
 *                       account email.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();

/** Resend's shared sender. Only delivers to the Resend account owner's own address. */
const DEFAULT_SENDER = "onboarding@resend.dev";

/**
 * Resolve the `from` header Resend will accept.
 *
 * 🔴 A BARE DISPLAY NAME 422s EVERY SEND. `ALERT_EMAIL_FROM` was set to
 * "Svideodownload" — no address. That is truthy, so it replaced the working
 * default, and Resend answered:
 *
 *   422 validation_error — Invalid `from` field. The email address needs to
 *   follow the `email@example.com` or `Name <email@example.com>` format.
 *
 * Every admin email had been failing on it, and nothing said so (see the
 * digest route). Rather than fail on a value that is obviously an intended
 * DISPLAY NAME, keep the name and attach the default sender — the operator
 * gets the branding they asked for and a working send, and the warning names
 * the fix. An address that is already well-formed is passed through untouched.
 */
export function resolveAlertFrom(raw: string | undefined | null): string {
  const configured = raw?.trim();
  if (!configured) return `FrenzSave <${DEFAULT_SENDER}>`;

  // `Name <a@b.c>` — already valid.
  if (/^[^<>]*<\s*[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+\s*>$/.test(configured)) return configured;
  // Bare `a@b.c` — also valid.
  if (/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(configured)) return configured;

  // Anything else is a display name (or malformed). Salvage it as one.
  const name = configured.replace(/[<>]/g, "").trim();
  return name ? `${name} <${DEFAULT_SENDER}>` : `FrenzSave <${DEFAULT_SENDER}>`;
}

const FROM = resolveAlertFrom(process.env.ALERT_EMAIL_FROM);

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
 * Live email diagnostic — reports the resolved config and performs a real send
 * to the configured recipients, returning Resend's exact status/body. Use it to
 * find out *why* milestone alerts aren't arriving without waiting on a milestone
 * or the dedupe lock. Never throws.
 */
export async function diagnoseEmail(): Promise<{
  keySet: boolean;
  recipients: string[];
  from: string;
  attempted: boolean;
  status?: number;
  ok?: boolean;
  body?: string;
  error?: string;
}> {
  const to = recipients();
  const base = { keySet: !!RESEND_API_KEY, recipients: to, from: FROM };
  if (!RESEND_API_KEY || to.length === 0) {
    return { ...base, attempted: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: "✅ FrenzSave alert test",
        html: alertEmailHtml({
          heading: "Alerts are working",
          intro: "This is a test of your admin alert pipeline. If you got this, milestone emails will arrive too.",
        }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text().catch(() => "");
    return { ...base, attempted: true, status: res.status, ok: res.ok, body: body.slice(0, 400) };
  } catch (err) {
    return { ...base, attempted: true, error: err instanceof Error ? err.message : "send failed" };
  }
}

/**
 * What actually became of an alert.
 *
 * 🔴 THIS USED TO RETURN `void`, AND THAT HID A REAL FAILURE. Resend was
 * rejecting the admin digest (the default `onboarding@resend.dev` sender may
 * only deliver to the Resend account owner's own address), but the cron route
 * had no way to see it: `sendAdminAlertOnce` swallowed the outcome by design
 * — "alerts must never throw into the caller" — so the digest reported
 * `{"ok":true,"sent":["daily"]}` for an email that was never delivered.
 *
 * Not throwing is still right; a failed alert must not break the job that
 * raised it. Reporting nothing is what was wrong. Callers may still ignore
 * this value, but the ones that describe their own outcome must not.
 */
export type AlertOutcome =
  /** Resend accepted it. */
  | "sent"
  /** Already alerted for this key — a legitimate skip, not a failure. */
  | "duplicate"
  /** Resend refused it, or the request failed. The dedupe lock was rolled back. */
  | "rejected"
  /** No API key or no recipients configured. */
  | "disabled";

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
): Promise<AlertOutcome> {
  if (!alertsEnabled()) return "disabled";
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("admin_alerts")
      .insert({ key: dedupeKey, kind, subject });
    // Duplicate key (already alerted) or table missing → nothing to do.
    if (error) return "duplicate";

    const sent = await sendAdminEmail(subject, html);
    if (!sent) {
      // Roll back the lock so a later event can retry this alert.
      await supabase.from("admin_alerts").delete().eq("key", dedupeKey);
      return "rejected";
    }
    return "sent";
  } catch {
    /* alerts must never throw into the caller */
    return "rejected";
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
  <p style="text-align:center;color:#4b5563;font-size:11px;margin:16px 0 0">FrenzSave · admin alert</p>
  </body></html>`;
}
