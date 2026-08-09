/**
 * Server-side event enrichment for the analytics pipeline (Phase 1).
 *
 * Geo comes from the edge (Vercel/Cloudflare inject it) — we store only coarse
 * country/region/city, never the raw IP. Device/browser/OS are parsed from the UA
 * with a small dependency-free matcher (good enough for dashboard breakdowns; a
 * heavier library would be overkill and add bundle/latency).
 */

export interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
}

export function geoFromHeaders(h: Headers): Geo {
  const country = h.get("x-vercel-ip-country") || h.get("cf-ipcountry") || null;
  const region = h.get("x-vercel-ip-country-region") || null;
  let city: string | null = null;
  try {
    city = decodeURIComponent(h.get("x-vercel-ip-city") || "") || null;
  } catch {
    city = h.get("x-vercel-ip-city") || null;
  }
  return { country: country && country !== "XX" ? country : null, region, city };
}

export interface UAInfo {
  device: string; // "mobile" | "tablet" | "desktop"
  browser: string;
  os: string;
}

/**
 * Automated traffic, by user agent.
 *
 * ── Why this was missing and why it matters (owner audit, 2026-08-09) ────────
 * Nothing in the pipeline looked at the UA, so anything that executed our JS was
 * a "visitor". Most classic crawlers never run JS and so never reached the
 * collector at all — which is exactly what made the gap easy to miss, because
 * the numbers looked plausible. What DOES run JS: headless Chrome (scrapers,
 * screenshot and SEO tools), uptime and synthetic monitors, link-preview
 * fetchers, and our own Playwright e2e runs. Each one inflated unique visitors,
 * sessions and page views, and none of them can ever become a download.
 *
 * ── Matched conservatively, on purpose ───────────────────────────────────────
 * A false positive here silently deletes a REAL person from every metric, which
 * is worse than the noise it removes. So this matches only tokens that are
 * unambiguous in a user agent — `bot`, `spider`, `crawler`, `headless`, named
 * monitors and named preview fetchers — and deliberately does not guess from
 * missing headers or odd version strings. `Mobile Safari` visitors from an
 * in-app browser are people, not bots, however unusual their UA looks.
 *
 * Events are MARKED rather than dropped (see migration 0115): the row stays
 * queryable, so a mis-classification can be found and reversed instead of
 * having silently deleted data.
 */
const BOT_PATTERN =
  /bot\b|bots\b|spider|crawler|crawling|scrap(?:er|y)|headless|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|datadog|newrelic|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|bingpreview|slurp|duckduckbot|facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|discordbot|slackbot|embedly|preview|monitor|curl\/|wget\/|python-requests|axios\/|okhttp|java\/|go-http-client|node-fetch|libwww|httpclient/i;

export function isBotUA(uaRaw: string | null): boolean {
  const ua = (uaRaw ?? "").trim();
  // No UA at all is not a browser doing normal navigation.
  if (ua.length === 0) return true;
  return BOT_PATTERN.test(ua);
}

export function parseUA(uaRaw: string | null): UAInfo {
  const ua = uaRaw || "";
  const os =
    /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Windows NT/i.test(ua) ? "Windows"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /CrOS/i.test(ua) ? "ChromeOS"
    : /Linux/i.test(ua) ? "Linux"
    : "Other";
  const device =
    /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? "tablet"
    : /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua) ? "mobile"
    : "desktop";
  // Order matters: Edge/OPR/Samsung masquerade as Chrome; Chrome masquerades as Safari.
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /SamsungBrowser/i.test(ua) ? "Samsung Internet"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : "Other";
  return { device, browser, os };
}
