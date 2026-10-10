"use client";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";

/**
 * Part 10 — SELECTIVE prefetch for the full-screen paid moments.
 *
 * A moment (download completed, a reward gate, back-after-away) used to start
 * loading its creative the instant it opened, so the sheet showed an empty
 * frame first. Now, when a moment is LIKELY on the page the member is on, its
 * ad is chosen ahead of time and only that ad's still image is fetched:
 *
 *   · an image ad → the image itself
 *   · a video ad  → its poster only. The video is NEVER prefetched; it streams
 *                   from the CDN when the sheet opens (§ large media never
 *                   through our servers, and no megabytes for a maybe).
 *
 * One file per placement per page, never on Save-Data or a 2G connection, and
 * only from the payload already in memory — warming never makes an ad request.
 * The moment then shows the SAME ad it warmed (`takeWarmed`), so the bytes are
 * never wasted on a different pick.
 */

const warmed = new Map<string, EligibleAd>();
const fetched = new Set<string>();

interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

/** Save-Data, 2G and slow-2G members get nothing ahead of time. */
export function mayWarm(conn: NetInfo | undefined = (globalThis.navigator as (Navigator & { connection?: NetInfo }) | undefined)?.connection): boolean {
  if (!conn) return true;
  if (conn.saveData) return false;
  return !(conn.effectiveType === "2g" || conn.effectiveType === "slow-2g");
}

/** The one URL worth fetching ahead for an ad: its image, or a video's poster — never a video. */
export function warmUrlOf(ad: Pick<EligibleAd, "mediaType" | "media" | "thumb">): string | null {
  if (ad.mediaType === "image") return ad.media || null;
  return ad.thumb || null;
}

/** Hold `ad` for `placement` and fetch its still image once. */
export function warm(placement: string, ad: EligibleAd): void {
  warmed.set(placement, ad);
  const url = warmUrlOf(ad);
  if (!url || fetched.has(url) || typeof Image === "undefined") return;
  fetched.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

/** The ad warmed for this placement if it may still serve (it is in the current pool). Consumed once. */
export function takeWarmed(placement: string, pool: readonly EligibleAd[], lastShown: string | null): EligibleAd | null {
  const ad = warmed.get(placement);
  warmed.delete(placement);
  if (!ad || ad.cr === lastShown) return null;
  return pool.find((x) => x.cr === ad.cr) ?? null;
}

export function isWarmed(placement: string): boolean {
  return warmed.has(placement);
}

/** Tests only. */
export function __resetWarm(): void {
  warmed.clear();
  fetched.clear();
}
