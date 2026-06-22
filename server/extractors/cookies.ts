/**
 * Builds a `Cookie:` header for extractor fetches from the same Netscape
 * cookies.txt used by yt-dlp (YTDLP_COOKIES). This lets the custom extractors
 * read sign-in-walled pages (Instagram/Facebook/Threads images & posts) directly
 * instead of always falling back to yt-dlp.
 */

interface Cookie {
  domain: string;
  includeSub: boolean;
  name: string;
  value: string;
}

let parsed: Cookie[] | null = null;

function parseAll(): Cookie[] {
  if (parsed) return parsed;
  parsed = [];
  const raw = process.env.YTDLP_COOKIES || "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const p = line.split("\t");
    if (p.length < 7) continue;
    parsed.push({
      domain: p[0]!.replace(/^\./, ""),
      includeSub: p[1] === "TRUE",
      name: p[5]!,
      value: p[6]!,
    });
  }
  return parsed;
}

export function hasCookies(): boolean {
  return parseAll().length > 0;
}

/** Returns a `name=value; …` Cookie header for the URL's host (or ""). */
export function cookieHeaderFor(urlStr: string): string {
  let host: string;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return "";
  }
  const map = new Map<string, string>();
  for (const c of parseAll()) {
    if (host === c.domain || host.endsWith(`.${c.domain}`)) {
      map.set(c.name, c.value); // last definition wins
    }
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}
