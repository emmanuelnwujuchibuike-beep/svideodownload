import { SITE_URL } from "@/lib/site";

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
      // A real reply_to (instead of a dead-end noreply) and a from display
      // name that matches the subject's brand mention both read as more
      // trustworthy to spam filters than a bare transactional blast.
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: SUPPORT_EMAIL }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace";

/**
 * The premium sign-in code email: real brand mark, the code as individual
 * digit chips (the unmistakable visual focus), expiry + security notice +
 * support footer. Table-based with inline styles (email clients ignore
 * stylesheets); a hidden preheader gives inbox list views a clean, branded
 * preview instead of an arbitrary snippet of the visible body. Dark-mode
 * friendly colors; the only remote asset is the small brand icon, so it
 * still renders correctly (just without the icon) if a client blocks images.
 */
export function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const expiry = EXPIRY_MINUTES >= 60 ? `${Math.round(EXPIRY_MINUTES / 60)} hour${EXPIRY_MINUTES >= 120 ? "s" : ""}` : `${EXPIRY_MINUTES} minutes`;
  const year = new Date().getFullYear();
  const preheader = `Your code is ${code} — it expires in ${expiry}. Never share it with anyone.`;

  const digitCells = code
    .split("")
    .map(
      (d) =>
        `<td style="width:34px;height:44px;background:#f4f4f9;border:1px solid #e6e6f0;border-radius:10px;text-align:center;font-family:${MONO};font-size:21px;font-weight:700;color:#17171c;">${d}</td>`,
    )
    .join(`<td style="width:7px;font-size:0;line-height:0;">&nbsp;</td>`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your Frenz sign-in code</title>
</head>
<body style="margin:0;padding:0;background:#eef0f7;">
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
    ${preheader}${"&#8203; ".repeat(60)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f7;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:24px;border:1px solid #ececf2;overflow:hidden;">
        <tr><td style="height:5px;background:linear-gradient(90deg,#0A84FF,#6C4DFF,#c026d3);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:40px 40px 0;text-align:center;">
          <img src="${SITE_URL}/brand/frenz-icon-og.png" width="52" height="52" alt="Frenz" style="display:block;margin:0 auto 14px;border-radius:13px;">
          <span style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.02em;">
            <span style="color:#17171c;">Frenz</span><span style="color:#0A84FF;">Save</span>
          </span>
        </td></tr>
        <tr><td style="padding:26px 40px 0;text-align:center;font-family:${FONT};">
          <p style="margin:0;font-size:19px;font-weight:800;color:#111116;">Your sign-in code</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#6b6b76;">Enter this code to finish signing in. It expires in ${expiry}.</p>
        </td></tr>
        <tr><td style="padding:26px 40px 0;">
          <table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr>${digitCells}</tr></table>
        </td></tr>
        <tr><td style="padding:26px 40px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6ff;border:1px solid #ece9fb;border-radius:14px;">
            <tr><td style="padding:14px 18px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:#5d5d68;">
              Didn't request this? You can safely ignore this email — no one can sign in without the code above. Never share it with anyone; Frenz will never ask you for it.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 40px 32px;font-family:${FONT};">
          <p style="margin:0;border-top:1px solid #ececf2;padding-top:16px;font-size:12px;line-height:1.6;color:#a0a0aa;">
            Need help? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#6C4DFF;text-decoration:none;">${SUPPORT_EMAIL}</a><br>
            Frenz · Download. Discover. Meet.
          </p>
          <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#b6b6c0;">
            You're receiving this email because a sign-in code was requested for ${to} on Frenz.
            This is an automated security message — replies go to our support inbox.<br>
            &copy; ${year} Frenz. All rights reserved.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Your Frenz sign-in code: ${code}\n\nEnter this code to finish signing in. It expires in ${expiry}.\n\nIf you didn't request this code, you can safely ignore this email. Never share this code with anyone.\n\nNeed help? ${SUPPORT_EMAIL}\n\nYou're receiving this email because a sign-in code was requested for ${to} on Frenz.\n(c) ${year} Frenz. All rights reserved.`;

  return send(to, `${code} is your Frenz sign-in code`, html, text);
}
