/**
 * Creator analytics (0297): where a view came from, as the hosting platform's request geolocation reports it —
 * a country code and a city name, nothing finer, and never the IP. Missing or malformed headers give nulls: such a view
 * is simply not counted in Top locations. The city header is URL-encoded by the platform.
 */
export function viewGeo(headers: Headers): { country: string | null; city: string | null } {
  const c = (headers.get("x-vercel-ip-country") ?? "").trim().toUpperCase();
  let city: string | null = null;
  try {
    const raw = decodeURIComponent(headers.get("x-vercel-ip-city") ?? "").trim();
    // eslint-disable-next-line no-control-regex -- refuse control characters in a header value
    city = raw && raw.length <= 80 && !/[\u0000-\u001f]/.test(raw) ? raw : null;
  } catch {
    city = null;
  }
  return { country: /^[A-Z]{2}$/.test(c) ? c : null, city };
}
