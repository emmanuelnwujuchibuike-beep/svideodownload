/**
 * Resend transactional email — used for sign-in codes (and future product
 * email). Calls Resend's REST API directly with fetch: no SDK dependency, so
 * package-lock never changes and the worker image is unaffected. No-ops
 * cleanly when RESEND_API_KEY is unset (local dev without email).
 *
 * `RESEND_FROM` must be a sender on a domain verified in the Resend dashboard
 * (e.g. "Frenz <login@frenzsave.com>").
 */

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || "Frenz <login@frenzsave.com>";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "nwujuchriss@gmail.com";
// Keep in sync with Supabase Auth's "Email OTP expiration" setting.
const EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 60);

export const hasResend = !!API_KEY;

async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The premium sign-in code email: minimal, brand-gradient wordmark, the code as
 * the unmistakable visual focus, expiry + security notice + support footer.
 * Table-based with inline styles (email clients ignore stylesheets); dark-mode
 * friendly colors; no images so it renders instantly and never looks broken.
 */
export function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const expiry = EXPIRY_MINUTES >= 60 ? `${Math.round(EXPIRY_MINUTES / 60)} hour${EXPIRY_MINUTES >= 120 ? "s" : ""}` : `${EXPIRY_MINUTES} minutes`;
  const year = new Date().getFullYear();

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Frenz sign-in code</title></head>
<body style="margin:0;padding:0;background:#f7f7fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;border:1px solid #ececf2;overflow:hidden;">
        <tr><td style="height:4px;background:linear-gradient(90deg,#0A84FF,#6C4DFF,#c026d3);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:36px 36px 0;">
          <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#6C4DFF;">Frenz</span>
        </td></tr>
        <tr><td style="padding:24px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:17px;font-weight:700;color:#17171c;">Your sign-in code</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#6b6b76;">Enter this code on the Frenz sign-in screen to continue. It expires in ${expiry}.</p>
        </td></tr>
        <tr><td style="padding:24px 36px 0;">
          <p style="margin:0;background:#f4f4f7;border:1px solid #e4e4ec;border-radius:14px;padding:18px 0;text-align:center;font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:0.3em;text-indent:0.3em;color:#17171c;">${code}</p>
        </td></tr>
        <tr><td style="padding:24px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8a94;">If you didn't request this code, you can safely ignore this email — no one can sign in without it. Never share this code with anyone; Frenz will never ask you for it.</p>
        </td></tr>
        <tr><td style="padding:28px 36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0;border-top:1px solid #ececf2;padding-top:16px;font-size:12px;line-height:1.6;color:#a0a0aa;">
            Need help? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#6C4DFF;text-decoration:none;">${SUPPORT_EMAIL}</a><br>
            Frenz · Download. Discover. Meet.
          </p>
          <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#b6b6c0;">
            You're receiving this email because a sign-in code was requested for ${to} on Frenz.
            This is an automated security message — replies aren't monitored.<br>
            &copy; ${year} Frenz. All rights reserved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Your Frenz sign-in code: ${code}\n\nEnter this code on the Frenz sign-in screen to continue. It expires in ${expiry}.\n\nIf you didn't request this code, you can safely ignore this email. Never share this code with anyone.\n\nNeed help? ${SUPPORT_EMAIL}\n\nYou're receiving this email because a sign-in code was requested for ${to} on Frenz.\n(c) ${year} Frenz. All rights reserved.`;

  return send(to, `${code} is your Frenz sign-in code`, html, text);
}
