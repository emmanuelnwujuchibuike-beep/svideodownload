import { NextResponse } from "next/server";
import { z } from "zod";

import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { clientId, securityEventLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "REPORT THIS" — a failed download, sent by the person it happened to
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-02: "put a promt for download fail so users can see a retry or
 * send report button that instantly send a fail report to the admin email with
 * the download link and details to investigate."
 *
 * ── Why this exists when automatic failure alerts already do ─────────────────
 *
 * `lib/analytics/download-failure-alert.ts` already emails admins when a
 * download ends badly, fed from the analytics pipeline. It is not a substitute
 * for this, for two reasons:
 *
 *   • It reports what the SERVER saw. A download that fails in the browser —
 *     a stream that dies after headers are sent, a save the OS refused — may
 *     never produce a terminal server event at all.
 *   • It is deduped and sampled by design, so it answers "is failure rate up?"
 *     and not "this exact link is broken, go look". A person pressing Report is
 *     asserting the second, and that is a different, more actionable signal.
 *
 * The immediate case: https://vt.tiktok.com/ZSVoptskq/ returns 502. Diagnosed
 * as TikTok's signed CDN URL answering 403 from Akamai by the time the worker
 * fetches it, after which every fallback in `resolveDownload` is exhausted. A
 * report carrying the LINK is what makes the next one of those diagnosable
 * without the owner relaying it by hand.
 *
 * ── 🔴 WHAT IS DELIBERATELY NOT COLLECTED ────────────────────────────────────
 *
 * No account id, no email, no visitor id, no cookies. A failure report needs
 * the link and the technical shape of the failure; attaching an identity to it
 * would turn a support gesture into tracking, and nothing in the diagnosis is
 * improved by knowing WHO hit it. The IP is used for rate limiting only and is
 * never written into the email.
 */

const schema = z.object({
  /** The source link that failed. The whole point of the report. */
  url: z.string().url().max(2048),
  platform: z.string().trim().max(40).optional().default(""),
  formatId: z.string().trim().max(80).optional().default(""),
  kind: z.string().trim().max(20).optional().default(""),
  title: z.string().trim().max(300).optional().default(""),
  /** Our own error code, when the failure produced one. */
  errorCode: z.string().trim().max(60).optional().default(""),
  /** The message the visitor actually saw, so the report matches their screen. */
  errorMessage: z.string().trim().max(500).optional().default(""),
  /** Which surface it failed on — downloader, history, batch. */
  surface: z.string().trim().max(40).optional().default(""),
});

/** Never let report text reach an HTML email unescaped. */
function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function POST(request: Request) {
  /*
    Rate limited per IP on the SECURITY limiter rather than the download one:
    this is a cheap write that sends mail, and a button anyone can press is a
    mail-flood primitive if it is not bounded. Reusing an existing limiter
    rather than adding a config knob nobody will tune.
  */
  const ip = clientId(request.headers);
  const { success } = await securityEventLimiter.limit(`report-dl:${ip}`);
  if (!success) {
    return NextResponse.json(
      { ok: false, error: "Too many reports. Please wait a moment." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid report." }, { status: 400 });
  }
  const r = parsed.data;

  const ua = request.headers.get("user-agent") ?? "";
  const rows = [
    { label: "Link", value: esc(r.url) },
    { label: "Platform", value: esc(r.platform || "unknown") },
    { label: "Format", value: esc([r.kind, r.formatId].filter(Boolean).join(" / ") || "—") },
    { label: "Title", value: esc(r.title || "—") },
    { label: "Error", value: esc([r.errorCode, r.errorMessage].filter(Boolean).join(" — ") || "—") },
    { label: "Surface", value: esc(r.surface || "—") },
    { label: "Device", value: esc(ua.slice(0, 180) || "—") },
    { label: "Reported", value: new Date().toISOString() },
  ];

  /*
    🔴 NOT deduped, unlike the automatic alert. A person pressing Report twice
    is telling us it is still broken, which is information — and suppressing a
    human's second report to protect an inbox is how a real outage gets one
    email and no follow-up. The rate limiter above is the flood control.

    Fire-and-forget on failure: a report that cannot be mailed must still
    answer OK to the person who sent it. They did their part, and telling them
    the report failed teaches them not to bother next time.
  */
  const sent = await sendAdminEmail(
    `Download failed — ${r.platform || "unknown"} — reported by a visitor`,
    alertEmailHtml({
      heading: "A visitor reported a failed download",
      intro:
        "Someone pressed Report on a download that failed. The link below is the one that did not work — it is the fastest way to reproduce it.",
      rows,
      footnote:
        "Sent from the download failure prompt. No account, email or visitor id is attached to this report.",
    }),
  ).catch(() => false);

  return NextResponse.json({ ok: true, delivered: sent });
}
