import type { DeviceType, RequestContext, BillingPlan } from "./types";

/** Cheap UA sniff — good enough for ad/affiliate targeting. */
export function deviceFromUA(ua: string | null): DeviceType {
  if (!ua) return "desktop";
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua) ? "mobile" : "desktop";
}

/** Best-effort country from edge headers (Vercel / Cloudflare). */
export function countryFromHeaders(headers: Headers): string | null {
  return (
    headers.get("x-vercel-ip-country") ||
    headers.get("cf-ipcountry") ||
    headers.get("x-country") ||
    null
  );
}

/**
 * Rough "monetizable value" heuristic (0–1). Tier-1 ad markets and organic
 * search referrers score higher; this lets the engine reserve premium ad fills
 * for higher-RPM traffic. Tune freely.
 */
const TIER1 = new Set(["US", "CA", "GB", "AU", "DE", "FR", "NL", "SE", "NO", "DK", "CH", "IE", "NZ"]);

export function trafficValue(country: string | null, referrer: string | null): number {
  let v = 0.5;
  if (country && TIER1.has(country.toUpperCase())) v += 0.3;
  if (referrer && /google\.|bing\.|duckduckgo\.|yahoo\./i.test(referrer)) v += 0.15;
  return Math.min(1, v);
}

export function buildRequestContext(
  request: Request,
  plan: BillingPlan,
  isDeveloper = false,
): RequestContext {
  const h = request.headers;
  const country = countryFromHeaders(h);
  return {
    plan,
    device: deviceFromUA(h.get("user-agent")),
    country,
    value: trafficValue(country, h.get("referer")),
    isDeveloper,
  };
}
