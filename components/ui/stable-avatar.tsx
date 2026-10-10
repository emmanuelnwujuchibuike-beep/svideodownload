"use client";

import { useState } from "react";

import { avatarSrc } from "@/lib/media/avatar-url";

/**
 * An avatar that never visibly reloads once it has been seen (owner,
 * 2026-10-09: "make the top and chat avatar to never reload on backswipe
 * unneccessarily").
 *
 * ── Why a plain <img> "reloaded" ─────────────────────────────────────────────
 * The bytes were already cached. What the owner saw was DECODING: a back-swipe
 * remounts the inbox, every row gets a brand-new <img>, and iOS decodes each
 * one asynchronously — so the ring sat empty for a frame or two and the face
 * popped in. Every back-swipe, every row.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 * Once a URL has decoded, a reference to that decoded image is kept here
 * (bounded, oldest dropped first), which keeps its bitmap in the browser's
 * memory cache. A later <img> for the same URL is rendered `decoding="sync"`,
 * so it paints in the SAME frame it mounts — no blank, no pop.
 *
 * It only ever changes when the URL changes, i.e. when someone actually
 * changes their photo. Nothing here polls or refetches.
 *
 * ── 2026-10-10: small, CORS, and cacheable on iOS ───────────────────────────
 * The owner tested the fix above on an iPhone and "nothing changed": this map
 * lives in memory, and iOS tears a home-screen app down constantly, so every
 * relaunch started empty and re-fetched each FULL ~512 px upload, which storage
 * serves `Cache-Control: no-cache`. Now every avatar is the Supabase render at
 * its drawn size (lib/media/avatar-url.ts, ~3 KB), loaded `crossorigin` so the
 * response is a real, small cache entry (an opaque one is padded to megabytes
 * in the quota and iOS silently stops storing them), and the service worker
 * keeps it cache-first in a cache that survives SW updates (public/sw/).
 */

const MAX_KEPT = 300;
const decoded = new Map<string, HTMLImageElement>();

function remember(url: string, img: HTMLImageElement): void {
  if (decoded.has(url)) decoded.delete(url); // refresh its place in the LRU
  decoded.set(url, img);
  if (decoded.size > MAX_KEPT) {
    const oldest = decoded.keys().next().value;
    if (oldest !== undefined) decoded.delete(oldest);
  }
}

/** True once `url` has decoded in this tab. */
export function isAvatarReady(url: string | null | undefined, displayPx = 52): boolean {
  return !!url && (decoded.has(url) || decoded.has(avatarSrc(url, displayPx)));
}

/*
  The same registry, for any image that remounts on navigation and must not
  flash (owner, 2026-10-09: "History Medias and the Frenz logo at the top
  reloads on every page entry") — SmartThumb (history tiles) and FrenzLogo.
*/
export function isImageSeen(url: string | null | undefined): boolean {
  return !!url && decoded.has(url);
}
export function markImageSeen(url: string, img: HTMLImageElement): void {
  remember(url, img);
}

/**
 * Decode avatars ahead of time (e.g. every row of an inbox that just arrived,
 * including the ones below the fold) so the first time each is mounted it is
 * already instant. Already-decoded URLs cost nothing.
 */
export function warmAvatars(urls: readonly (string | null | undefined)[], displayPx = 52): void {
  if (typeof Image === "undefined") return;
  for (const raw of urls) {
    // the SAME url and CORS mode StableAvatar requests, or the warm-up is a second download
    const url = avatarSrc(raw, displayPx);
    if (!url || decoded.has(url)) continue;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    img
      .decode()
      .then(() => remember(url, img))
      .catch(() => {
        /* a broken avatar simply stays un-warmed; the <img> shows its own fallback */
      });
  }
}

export function StableAvatar({
  src,
  alt = "",
  className,
  width,
  height,
  loading,
}: {
  src: string;
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  /** "lazy" for long lists (Part 9) — kept even once seen; a seen avatar then decodes sync as it loads */
  loading?: "lazy" | "eager";
}) {
  // a render that fails (transformations off, a moved file) falls back to the original once
  const [failedRender, setFailedRender] = useState<string | null>(null);
  const rendered = avatarSrc(src, width ?? 52);
  const url = failedRender === rendered ? src : rendered;
  const ready = decoded.has(url);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      crossOrigin="anonymous"
      width={width}
      height={height}
      // lazy stays lazy even once seen: a long list must never load every avatar at once (2026-10-09)
      loading={loading}
      draggable={false}
      decoding={ready ? "sync" : "async"}
      onLoad={(e) => remember(url, e.currentTarget)}
      onError={() => {
        if (url !== src) setFailedRender(rendered);
      }}
      className={className}
    />
  );
}
