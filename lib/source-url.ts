/**
 * The pasted-link rules, with no dependency — the paste box on the landing and on every downloader
 * page checks a link with these, and importing zod for it put 56 kB of validator into those pages'
 * first scripts (2026-10-26). `sourceUrlSchema` (lib/validation.ts) runs the SAME rules on the
 * server, so the two cannot disagree.
 *
 * We only accept http/https and reject hosts that resolve to private / loopback ranges to mitigate
 * SSRF, since yt-dlp will fetch the URL server-side.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^\[?::1\]?$/, // ipv6 loopback
  /^\[?fc00:/i, // ipv6 unique local
  /^\[?fe80:/i, // ipv6 link local
  /\.local$/i,
];

export const SOURCE_URL_MAX = 2048;
export const SOURCE_URL_EMPTY = "Please paste a link.";
export const SOURCE_URL_TOO_LONG = "That URL is too long.";

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

/** What is wrong with an already-trimmed, length-checked link, or null when it is acceptable. */
export function sourceUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https links are supported.";
  if (isPrivateHost(url.hostname)) return "That host is not allowed.";
  return null;
}

/**
 * The whole check, in the schema's order (empty, too long, then the URL itself): the trimmed link, or the
 * first message the schema would have reported.
 */
export function checkSourceUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (value.length < 1) return { ok: false, message: SOURCE_URL_EMPTY };
  if (value.length > SOURCE_URL_MAX) return { ok: false, message: SOURCE_URL_TOO_LONG };
  const problem = sourceUrlProblem(value);
  return problem ? { ok: false, message: problem } : { ok: true, url: value };
}
