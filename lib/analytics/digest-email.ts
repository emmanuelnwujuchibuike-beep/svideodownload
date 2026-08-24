import "server-only";

import type { DigestData, DigestMetric, DigestPeriod } from "@/lib/analytics/digest";

/**
 * The digest's HTML — a distinct template from `alertEmailHtml` in `lib/notify.ts`
 * on purpose. That shell is a small dark alert card built for a one-line event;
 * this is a full management report with a dozen numbers and a chart, and needs
 * its own scannable structure — grouped sections with headers, not one flat
 * list of rows. Table-based layout throughout (no flexbox/grid) because this
 * renders in mail clients, several of which still run on a stripped-down CSS
 * engine.
 */

const TITLE: Record<DigestPeriod, string> = {
  daily: "Daily digest",
  weekly: "Weekly digest",
  monthly: "Monthly digest",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function trendChip(trendPct: number | null): string {
  if (trendPct === null) return "";
  const up = trendPct >= 0;
  const color = up ? "#059669" : "#dc2626";
  const bg = up ? "#ecfdf5" : "#fef2f2";
  const arrow = up ? "&#9650;" : "&#9660;";
  const abs = Math.abs(trendPct);
  const shown = abs > -10 && abs < 10 ? abs.toFixed(1) : abs.toFixed(0);
  return `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:${bg};color:${color};font-size:11px;font-weight:700">${arrow} ${shown}%</span>`;
}

function statCard(m: DigestMetric): string {
  return `<td class="fz-stat" style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;background-color:#ffffff" valign="top">
    <div class="fz-muted" style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.03em">${esc(m.label)}</div>
    <div class="fz-strong" style="margin-top:4px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.2">${fmt(m.value)}${trendChip(m.trendPct)}</div>
  </td>`;
}

/** Two stat cards per row, table-based so the grid holds up in Outlook. */
function statGrid(metrics: DigestMetric[]): string {
  const rows: string[] = [];
  for (let i = 0; i < metrics.length; i += 2) {
    const a = metrics[i]!;
    const b = metrics[i + 1];
    rows.push(
      `<tr>${statCard(a)}<td style="width:10px"></td>${b ? statCard(b) : `<td style="border:none"></td>`}</tr>` +
        `<tr><td style="height:10px" colspan="3"></td></tr>`,
    );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rows.join("")}</table>`;
}

function section(title: string, subtitle: string | null, inner: string): string {
  return `<tr><td style="padding:22px 26px 4px">
    <h3 class="fz-strong" style="margin:0 0 2px;font-size:14px;font-weight:800;color:#0f172a;letter-spacing:.01em">${esc(title)}</h3>
    ${subtitle ? `<p class="fz-muted" style="margin:0 0 12px;font-size:12px;color:#94a3b8">${esc(subtitle)}</p>` : `<div style="height:10px"></div>`}
    ${inner}
  </td></tr>`;
}

/** An email-safe "area" chart: a row of height-scaled table cells. Div-height
 *  bars over CSS gradients render correctly in every modern client; the one
 *  known gap is classic desktop Outlook (Word rendering engine), which will
 *  show flattened bars rather than a broken layout — a documented, acceptable
 *  degrade rather than an attempt at full VML for a single admin-facing email. */
function chartHtml(chart: { label: string; value: number }[], metricLabel: string): string {
  if (chart.length === 0) return `<p class="fz-muted" style="font-size:12px;color:#94a3b8;margin:0">No data for this window yet.</p>`;
  const max = Math.max(1, ...chart.map((p) => p.value));
  const MAX_H = 96;
  const showEvery = chart.length > 16 ? Math.ceil(chart.length / 16) : 1;
  const cells = chart
    .map((p, i) => {
      const h = Math.max(2, Math.round((p.value / max) * MAX_H));
      const showLabel = i === 0 || i === chart.length - 1 || i % showEvery === 0;
      return `<td align="center" valign="bottom" style="padding:0 1px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>
          <td height="${MAX_H - h}" style="line-height:1px;font-size:1px">&nbsp;</td>
        </tr><tr>
          <td height="${h}" style="background:linear-gradient(180deg,#6366f1,#8b5cf6);background-color:#7c6bf0;border-radius:3px 3px 0 0;line-height:1px;font-size:1px" title="${fmt(p.value)}">&nbsp;</td>
        </tr></table>
        <div class="fz-muted" style="font-size:8px;color:#94a3b8;margin-top:4px;white-space:nowrap">${showLabel ? esc(p.label) : "&nbsp;"}</div>
      </td>`;
    })
    .join("");
  return `<p class="fz-muted" style="margin:0 0 10px;font-size:11px;color:#6b7280">${esc(metricLabel)} per ${chart.length > 24 ? "day" : "hour"}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
}

function topPagesHtml(pages: { label: string; views: number }[]): string {
  if (pages.length === 0) return `<p class="fz-muted" style="font-size:12px;color:#94a3b8;margin:0">No page views recorded yet.</p>`;
  const max = Math.max(1, ...pages.map((p) => p.views));
  const rows = pages
    .map(
      (p, i) => `<tr>
      <td class="fz-strong" style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;width:20px">${i + 1}</td>
      <td class="fz-muted" style="padding:6px 0;font-size:13px;color:#334155">${esc(p.label)}
        <div class="fz-track" style="margin-top:4px;height:5px;border-radius:3px;background-color:#eef2ff;width:100%">
          <div style="height:5px;border-radius:3px;background:linear-gradient(90deg,#6366f1,#8b5cf6);background-color:#7c6bf0;width:${Math.max(4, Math.round((p.views / max) * 100))}%"></div>
        </div>
      </td>
      <td class="fz-strong" style="padding:6px 0 6px 10px;font-size:13px;color:#0f172a;font-weight:700;text-align:right;white-space:nowrap">${fmt(p.views)}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

export function digestEmailSubject(data: DigestData): string {
  const total = data.metrics.find((m) => m.key === "downloads_total")?.value ?? 0;
  return `${TITLE[data.period]} — ${fmt(total)} downloads · FrenzSave`;
}

export function digestEmailHtml(data: DigestData): string {
  const byKey = (k: string) => data.metrics.find((m) => m.key === k)!;
  const traffic = [byKey("visitors"), byKey("page_views"), byKey("new_visitors"), byKey("returning_visitors")];
  const downloadsGroup = [
    byKey("downloads_completed"),
    byKey("downloads_failed"),
    byKey("downloads_cancelled"),
    byKey("downloads_abandoned"),
  ];
  const monetization = [byKey("rewards_watched"), byKey("idle_interstitials")];
  const usersGroup = [
    byKey("signed_in_downloads"),
    byKey("anonymous_downloads"),
    byKey("new_signups"),
    byKey("repeat_anonymous_visitors"),
    byKey("repeat_anonymous_downloads"),
  ];
  const totalDownloads = byKey("downloads_total");

  const warnings = data.warnings.length
    ? `<tr><td style="padding:0 26px 4px">
        ${data.warnings
          .map(
            (w) =>
              `<p style="margin:0 0 6px;padding:8px 10px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:11px">${esc(w)}</p>`,
          )
          .join("")}
      </td></tr>`
    : "";

  /*
    🔴 THE TOTAL DOWNLOADS FIGURE VANISHED IN DARK MODE (owner, 2026-08-24).

    It was #1e1b4b text on a panel whose only background was a linear-gradient.
    Dark-mode clients that auto-invert do so per DECLARED COLOR: they invert
    `color` and `background-color`, but a gradient is a background IMAGE and is
    left alone. The text went pale, the panel stayed pale, and the number
    disappeared — while every other figure, sitting on a solid white
    background-color, inverted in step and stayed readable. That is why exactly
    one number broke and the rest were fine.

    Two fixes, because no single one covers every client:
      1. Declare `color-scheme`. Apple Mail and iOS then stop force-inverting
         and honour the palette below instead of inventing their own.
      2. Never put text over a gradient. Every surface carrying text now has a
         solid `background-color` that inverts together with it, so even a
         client that ignores all of this keeps its contrast.

    The media query is the intentional dark palette for clients that support
    it; rule 2 is what protects the clients that don't. Kept in the source
    rather than as an HTML comment — the reasoning is for us, and every byte
    of it would otherwise ship in each email.
  */
  return `<!doctype html><html><head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) {
      .fz-body   { background:#0b1120 !important; }
      .fz-card   { background:#111a2e !important; border-color:#1f2a44 !important; }
      .fz-hero   { background-color:#1c2444 !important; border-color:#33406b !important; }
      .fz-stat   { background-color:#18213a !important; border-color:#27324f !important; }
      .fz-strong { color:#f8fafc !important; }
      .fz-eyebrow{ color:#c4b5fd !important; }
      .fz-muted  { color:#94a3b8 !important; }
      .fz-track  { background-color:#27324f !important; }
    }
  </style>
  </head><body class="fz-body" style="margin:0;background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fz-card" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="height:5px;background:linear-gradient(90deg,#2563eb,#7c3aed);background-color:#7c3aed"></td></tr>
    <tr><td style="padding:26px 26px 18px">
      <p class="fz-eyebrow" style="margin:0 0 2px;font-size:11px;font-weight:700;color:#7c3aed;letter-spacing:.06em;text-transform:uppercase">FrenzSave · admin report</p>
      <h1 class="fz-strong" style="margin:0;font-size:22px;font-weight:800;color:#0f172a">${TITLE[data.period]}</h1>
      <p class="fz-muted" style="margin:6px 0 0;font-size:13px;color:#64748b">${esc(data.windowLabel)}</p>
    </td></tr>

    <tr><td style="padding:0 26px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fz-hero" style="background-color:#eef2ff;border-radius:16px;border:1px solid #e0e7ff">
        <tr><td style="padding:18px 20px">
          <div class="fz-eyebrow" style="font-size:12px;font-weight:700;color:#6d28d9;text-transform:uppercase;letter-spacing:.03em">Total downloads</div>
          <div class="fz-strong" style="margin-top:4px;font-size:34px;font-weight:800;color:#1e1b4b">${fmt(totalDownloads.value)}${trendChip(totalDownloads.trendPct)}</div>
        </td></tr>
      </table>
    </td></tr>

    ${warnings}

    ${section("Traffic", "Visitors and page views for the window.", statGrid(traffic))}
    ${section("Downloads by outcome", "Every attempt, broken down by how it ended.", statGrid(downloadsGroup))}
    ${section("Monetization", "Ad engagement inside the window.", statGrid(monetization))}
    ${section("Audience", "Who's downloading, and who's new.", statGrid(usersGroup))}
    ${section("Top 5 pages", "Most-viewed surfaces this window.", topPagesHtml(data.topPages))}
    ${section(data.chartMetricLabel, "Trend across the window.", chartHtml(data.chart, data.chartMetricLabel))}

    <tr><td style="padding:18px 26px 26px">
      <p class="fz-muted" style="margin:0;font-size:11px;color:#94a3b8">Generated ${esc(new Date(data.generatedAt).toUTCString())}. Figures are rolling windows ending at send time, not calendar-aligned days/weeks/months.</p>
    </td></tr>
  </table>
  <p class="fz-muted" style="text-align:center;color:#94a3b8;font-size:11px;margin:14px 0 0">FrenzSave · automated admin digest</p>
  </body></html>`;
}
