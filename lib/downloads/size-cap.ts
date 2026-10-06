/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LARGEST FILE ONE DOWNLOAD MAY STREAM (2026-10-06, Railway egress spike)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured on production: Railway network egress $7 in 2 hours. The source
 * was Telegram video — t.me/estrellitasof/848 alone is a 31-minute, 750 MB
 * file and was requested 76 times in 3 hours. A file that size cannot finish
 * inside Vercel's 300 s function limit through the worker proxy, so the
 * stream was cut, the browser retried (up to 3 attempts) and people tapped
 * again — and every attempt re-sent hundreds of MB out of Railway for a file
 * that was never saved. The browser also holds the whole file in memory
 * (features/downloads/manager.ts), which a phone cannot do at 750 MB anyway.
 *
 * So the size is checked BEFORE the bytes move, in both places they could:
 *   · the worker refuses up front (server/services/download-response.ts);
 *   · Vercel's proxy cancels the worker's stream the moment its headers show
 *     the size (lib/worker.ts) — effective even before the worker redeploys.
 *
 * `DOWNLOAD_MAX_BYTES` overrides the default without a code change.
 */

export const DEFAULT_MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export function maxDownloadBytes(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DOWNLOAD_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DOWNLOAD_BYTES;
}

/**
 * The cap for a plan. Owner, 2026-10-06: "let only pro users to be able to
 * download a link that is as large as 200mb and above, free shouldn't be
 * able." Free (signed out included) gets the cap; Pro and Business get none.
 * `Infinity` means no cap.
 */
export function maxDownloadBytesFor(plan: string | null | undefined, env?: Record<string, string | undefined>): number {
  return plan === "pro" || plan === "business" ? Number.POSITIVE_INFINITY : maxDownloadBytes(env);
}

export function isTooLarge(bytes: number | null | undefined, limit: number = maxDownloadBytes()): boolean {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > limit;
}

const mb = (b: number) => `${Math.round(b / (1024 * 1024))} MB`;

/** The sentence the download card shows. Contains "too large" — retry-policy will not retry it. */
export function tooLargeMessage(bytes: number, limit: number = maxDownloadBytes()): string {
  return `This file is too large for the free plan (${mb(bytes)}). Files of ${mb(limit)} and over download with Pro — upgrade to save it.`;
}

/** Header the trusted Vercel proxy uses to tell the worker the caller's cap. */
export const MAX_BYTES_HEADER = "x-max-download-bytes";

/** Parse the cap the proxy sent: a positive number, "none", or (absent/garbled) the default. */
export function capFromHeader(value: string | null): number {
  if (value === "none") return Number.POSITIVE_INFINITY;
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : maxDownloadBytes();
}

export function capToHeader(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : "none";
}
