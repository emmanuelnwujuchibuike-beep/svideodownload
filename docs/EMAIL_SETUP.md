# Email setup (sign-in codes via Resend)

The 6-digit sign-in code email is **built into the app** (`lib/email/resend.ts`)
and sent through Resend's API. **Supabase never sends the sign-in email**, so you
do NOT need Supabase SMTP or a Supabase email template for login to work.

## The two things that must be true

1. **`RESEND_API_KEY` is set on Vercel** (Project → Settings → Environment
   Variables → add for Production + Preview → redeploy). ✅ already done.

2. **A domain is verified in Resend.** Resend only delivers real mail from a
   domain you've proven you own:
   - Resend dashboard → **Domains** → **Add Domain** → enter `frenzsave.com`.
   - Resend shows 3–4 DNS records (SPF/DKIM, usually TXT + CNAME/MX).
   - Add those records wherever frenzsave.com's DNS lives (if the domain is on
     Vercel: Vercel → Domains → frenzsave.com → DNS Records).
   - Wait for Resend to show **Verified** (minutes to a few hours).

   Without this, Resend stays in test mode: it can only send from
   `onboarding@resend.dev` **to your own Resend account email** — other users
   would never get their codes.

## What `RESEND_FROM` is (and when you can skip it)

It's simply the **"From" line** users see in their inbox, in the standard
format `Display Name <address@your-verified-domain>`:

```
RESEND_FROM=Frenz <login@frenzsave.com>
```

- The address does **not** need a real inbox to exist — it's a sender
  identity, not a mailbox. `login@`, `hello@`, `no-reply@` all work.
- The part after `@` **must be the domain you verified in Resend**.
- The app's default is already `Frenz <login@frenzsave.com>` — so **if the
  domain you verified is frenzsave.com, you don't need to set RESEND_FROM at
  all.** Only set it if you verified a different domain, e.g.
  `RESEND_FROM=Frenz <login@frenz.app>`.

## Optional: the 5-minute code expiry

The email says how long the code lasts. Two settings, keep them in sync:

- Supabase dashboard → Authentication → Providers → Email → **Email OTP
  expiration** → `300` (seconds).
- Vercel env: `OTP_EXPIRY_MINUTES=5` (only changes the wording in the email).

If you skip this, codes last 1 hour (Supabase's default) and the email says so.

## Optional: Supabase SMTP (not required for login)

Login codes never touch Supabase's mailer. But Supabase itself may send a few
rare emails (e.g. "confirm email change"). If you ever want those to come from
your domain too, point Supabase's SMTP at Resend — the exact values are on
Resend's own docs page (resend.com/docs/send-with-smtp): enter them in the
Supabase dashboard → Project Settings → Authentication → SMTP Settings, using
your API key as the SMTP credential and `login@frenzsave.com` / `Frenz` as the
sender. (Values intentionally not listed here in credential format — secret
scanners flag Host/Username/Password blocks in public repos as leaked SMTP
credentials even when they only contain placeholders.)

And if you do that, you can paste this premium template into Supabase →
Authentication → **Email Templates** → *Magic Link* (it shows the code big and
centered; `{{ .Token }}` is Supabase's placeholder for the 6-digit code):

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7fa;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;border:1px solid #ececf2;overflow:hidden;">
      <tr><td style="height:4px;background:linear-gradient(90deg,#0A84FF,#6C4DFF,#c026d3);font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:36px 36px 0;">
        <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#6C4DFF;">Frenz</span>
      </td></tr>
      <tr><td style="padding:24px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;font-size:17px;font-weight:700;color:#17171c;">Your sign-in code</p>
        <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#6b6b76;">Enter this code on the Frenz sign-in screen to continue.</p>
      </td></tr>
      <tr><td style="padding:24px 36px 0;">
        <p style="margin:0;background:#f4f4f7;border:1px solid #e4e4ec;border-radius:12px;padding:16px 0;text-align:center;font-family:'SF Mono',SFMono-Regular,Consolas,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:0.35em;color:#17171c;">{{ .Token }}</p>
      </td></tr>
      <tr><td style="padding:24px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8a94;">If you didn't request this code, you can safely ignore this email. Never share this code with anyone; Frenz will never ask you for it.</p>
      </td></tr>
      <tr><td style="padding:28px 36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <p style="margin:0;border-top:1px solid #ececf2;padding-top:16px;font-size:12px;line-height:1.6;color:#a0a0aa;">Frenz · Download. Discover. Meet.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## Quick test once the domain verifies

Open the live site logged-out → Continue with Email → enter your address →
you should receive "123456 is your Frenz sign-in code" from `Frenz
<login@frenzsave.com>` within seconds.
