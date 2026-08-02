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
