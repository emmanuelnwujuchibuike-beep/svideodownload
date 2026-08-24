import { describe, expect, it } from "vitest";

import { resolveAlertFrom, verifiedSender } from "./notify";

/*
  ── The 422 that silenced every admin email ────────────────────────────────
  Measured against production on 2026-08-24, via /api/cron/digest:

    from:   "Svideodownload"
    to:     ["nwujuchriss@gmail.com"]
    status: 422
    body:   {"statusCode":422,"name":"validation_error",
             "message":"Invalid `from` field. The email address needs to follow
             the `email@example.com` or `Name <email@example.com>` format."}

  `ALERT_EMAIL_FROM` held a bare display name. Being truthy, it replaced the
  working default, so every admin email — digests, milestone alerts, download
  failure alerts, wallpaper reminders — had been rejected, and the digest cron
  reported them as sent.
*/
/** What the sign-in path sends as, and therefore what admin mail falls back to. */
const OTP_SENDER = "Frenz <login@frenzsave.com>";

describe("resolveAlertFrom", () => {
  it("discards a bare display name — THE PRODUCTION BUG", () => {
    /*
      Owner, on receiving the repaired digest: "it sent as an onboarding and as
      svideodownload, instead of frenz like the main otp route." An address-less
      value cannot be sent from, and bolting a default address onto it produces
      a working email wearing the wrong identity — "Svideodownload" is the
      repository's name; the brand is Frenz. Drop it and use the proven sender.
    */
    expect(resolveAlertFrom("Svideodownload", OTP_SENDER)).toBe(OTP_SENDER);
  });

  it("passes through a well-formed `Name <addr>`", () => {
    const from = "Frenz Alerts <alerts@frenzsave.com>";
    expect(resolveAlertFrom(from, OTP_SENDER)).toBe(from);
  });

  it("passes through a bare address", () => {
    expect(resolveAlertFrom("alerts@frenzsave.com", OTP_SENDER)).toBe("alerts@frenzsave.com");
  });

  it("falls back when unset, empty, or whitespace", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(resolveAlertFrom(raw, OTP_SENDER)).toBe(OTP_SENDER);
    }
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(resolveAlertFrom("  alerts@frenzsave.com  ", OTP_SENDER)).toBe("alerts@frenzsave.com");
  });

  it("discards malformed values rather than repairing them into a new 422", () => {
    for (const raw of ["Svideodownload <", "<>", "Weird <Name", "no-at-sign", "a b c", "a@b"]) {
      expect(resolveAlertFrom(raw, OTP_SENDER), `input: ${JSON.stringify(raw)}`).toBe(OTP_SENDER);
    }
  });

  it("always emits something Resend's own format rule accepts", () => {
    const ACCEPTED = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]*<\s*[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+\s*>)$/;
    const inputs = [
      undefined,
      "",
      "Svideodownload",
      "Frenz Alerts <alerts@frenzsave.com>",
      "alerts@frenzsave.com",
      "no-at-sign",
      "<>",
      "Weird <Name",
      "a b c",
    ];
    for (const raw of inputs) {
      expect(resolveAlertFrom(raw, OTP_SENDER), `input: ${JSON.stringify(raw)}`).toMatch(ACCEPTED);
    }
  });

  it("never lets admin mail present a different identity from the sign-in email", () => {
    // One product, one sender. Anything unusable resolves to the OTP sender.
    for (const raw of [undefined, "", "Svideodownload", "<>", "nonsense"]) {
      expect(resolveAlertFrom(raw, verifiedSender(undefined))).toBe(OTP_SENDER);
    }
  });
});

/*
  ── Reuse the sender that is PROVEN to deliver ─────────────────────────────
  Admin mail used to fall back to `onboarding@resend.dev`, Resend's shared
  sender, which only delivers to the Resend account owner's own address. It
  reached the owner by coincidence — a second address in ALERT_EMAIL_TO would
  have silently failed.

  The sign-in path already sends from a domain verified in Resend and its mail
  arrives, and app/api/auth/otp/route.ts has NO other route (it hard-errors
  when Resend is unconfigured), so a delivered sign-in code is proof of that
  sender. These pin that admin mail derives its address from the same value —
  never a new local part, which could drift from what is actually verified.
*/
describe("verifiedSender — mirrors lib/email/resend.ts", () => {
  it("defaults to exactly what the OTP path defaults to", () => {
    // If lib/email/resend.ts's default changes, this fails — which is the point.
    expect(verifiedSender(undefined)).toBe(OTP_SENDER);
    expect(verifiedSender("")).toBe(OTP_SENDER);
  });

  it("honours a configured RESEND_FROM verbatim", () => {
    expect(verifiedSender("Frenz Support <hello@example.org>")).toBe(
      "Frenz Support <hello@example.org>",
    );
    expect(verifiedSender("hello@example.org")).toBe("hello@example.org");
  });

  it("ignores a RESEND_FROM that has no address", () => {
    expect(verifiedSender("Svideodownload")).toBe(OTP_SENDER);
  });

  it("never returns Resend's shared onboarding sender", () => {
    // That address only delivers to the Resend account owner, so it silently
    // caps who can ever receive an alert.
    for (const raw of [undefined, "", "   ", "Frenz <login@frenzsave.com>", "nonsense"]) {
      expect(verifiedSender(raw)).not.toContain("onboarding@resend.dev");
    }
  });
});
