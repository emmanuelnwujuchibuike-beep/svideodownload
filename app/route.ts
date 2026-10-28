import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderLanding } from "@/lib/landing-static/html";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import { SITE_URL } from "@/lib/site";

/**
 * `/` — the landing / download page, as ONE static HTML document with no React on it (lib/landing-static/html.ts,
 * design/frenz-landing.html; owner brief 2026-10-27: "fast, light and cool-running", performance above effects).
 *
 * Built at deploy time and refreshed once a day — the same freshness the old landing had (its root layout's
 * revalidate), so an admin's Google tag change still lands within a day. The page's own scripts are versioned by
 * the hash of their contents, so they can be cached for a year (next.config.ts: /landing/*).
 *
 * It replaces app/(marketing)/page.tsx. A route handler at "/" renders no layout: the root layout's boot splash,
 * fonts and site-wide scripts never reach this page — the analytics and ad units it needs are loaded by
 * public/landing/extras.js after load + idle, under the same rules as the app's own units.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

const FILES = ["core.js", "result.js", "sheets.js", "extras.js"];

function scriptsVersion(): string {
  const h = createHash("sha256");
  for (const f of FILES) {
    try {
      h.update(readFileSync(path.join(process.cwd(), "public", "landing", f)));
    } catch {
      h.update(f);
    }
  }
  return h.digest("hex").slice(0, 12);
}

export async function GET() {
  const settings = await getMonetizationSettings().catch(() => null);
  const origin = (process.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN || "https://svideodownload-worker-production.up.railway.app").trim().replace(/\/$/, "");
  const html = renderLanding({
    siteUrl: SITE_URL,
    jsVersion: scriptsVersion(),
    downloadOrigin: origin,
    direct: process.env.NEXT_PUBLIC_DOWNLOAD_DIRECT !== "0",
    googleTagId: (settings?.googleTagId ?? "").trim() || null,
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
