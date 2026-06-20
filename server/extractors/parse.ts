/**
 * Small HTML/JSON parsing helpers shared by the page-scraping extractors
 * (Instagram, Facebook, Pinterest). These platforms embed direct media URLs in
 * Open Graph meta tags or inline JSON; we pull them out with targeted regexes.
 */

export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Decodes a JSON-escaped URL string (handles `\/`, `\uXXXX`, `&`, …). */
export function unescapeJsonUrl(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
  }
}

/** Returns the content of an Open Graph / meta tag, or null. */
export function metaContent(html: string, property: string): string | null {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${esc}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1]);
  }
  return null;
}

/** Returns the first capture group of the first matching regex, or null. */
export function firstMatch(html: string, ...regexes: RegExp[]): string | null {
  for (const re of regexes) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
