import { describe, expect, it } from "vitest";

import { resolveAlertFrom } from "./notify";

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
describe("resolveAlertFrom", () => {
  const SENDER = "onboarding@resend.dev";

  it("salvages a bare display name — THE PRODUCTION BUG", () => {
    expect(resolveAlertFrom("Svideodownload")).toBe(`Svideodownload <${SENDER}>`);
  });

  it("passes through a well-formed `Name <addr>`", () => {
    const from = "Frenzsave Alerts <alerts@frenzsave.com>";
    expect(resolveAlertFrom(from)).toBe(from);
  });

  it("passes through a bare address", () => {
    expect(resolveAlertFrom("alerts@frenzsave.com")).toBe("alerts@frenzsave.com");
  });

  it("falls back when unset, empty, or whitespace", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(resolveAlertFrom(raw)).toBe(`FrenzSave <${SENDER}>`);
    }
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(resolveAlertFrom("  alerts@frenzsave.com  ")).toBe("alerts@frenzsave.com");
    expect(resolveAlertFrom("  Svideodownload  ")).toBe(`Svideodownload <${SENDER}>`);
  });

  it("strips stray angle brackets rather than emitting a second pair", () => {
    // "Name <" would otherwise produce "Name < <addr>", which 422s again —
    // the salvage must not be able to create the very error it repairs.
    expect(resolveAlertFrom("Svideodownload <")).toBe(`Svideodownload <${SENDER}>`);
    expect(resolveAlertFrom("<>")).toBe(`FrenzSave <${SENDER}>`);
  });

  it("always emits something Resend's own format rule accepts", () => {
    const ACCEPTED = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]*<\s*[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+\s*>)$/;
    const inputs = [
      undefined,
      "",
      "Svideodownload",
      "Frenzsave Alerts <alerts@frenzsave.com>",
      "alerts@frenzsave.com",
      "no-at-sign",
      "<>",
      "Weird <Name",
      "a b c",
    ];
    for (const raw of inputs) {
      expect(resolveAlertFrom(raw), `input: ${JSON.stringify(raw)}`).toMatch(ACCEPTED);
    }
  });
});
