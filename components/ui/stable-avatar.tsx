"use client";

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
export function isAvatarReady(url: string | null | undefined): boolean {
  return !!url && decoded.has(url);
}

/*
  The same registry, for any image that remounts on navigation and must not
  flash (owner, 2026-10-09: "History Medias and the Frenz logo at the top
  reloads on every page entry") — SmartThumb (history tiles) and FrenzLogo.
*/
export const isImageSeen = isAvatarReady;
export function markImageSeen(url: string, img: HTMLImageElement): void {
  remember(url, img);
}

/**
 * Decode avatars ahead of time (e.g. every row of an inbox that just arrived,
 * including the ones below the fold) so the first time each is mounted it is
 * already instant. Already-decoded URLs cost nothing.
 */
export function warmAvatars(urls: readonly (string | null | undefined)[]): void {
  if (typeof Image === "undefined") return;
  for (const url of urls) {
    if (!url || decoded.has(url)) continue;
    const img = new Image();
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
  const ready = decoded.has(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      // lazy stays lazy even once seen: a long list must never load every avatar at once (2026-10-09)
      loading={loading}
      draggable={false}
      decoding={ready ? "sync" : "async"}
      onLoad={(e) => remember(src, e.currentTarget)}
      className={className}
    />
  );
}
