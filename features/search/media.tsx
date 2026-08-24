"use client";

import { Play, UserRound } from "lucide-react";
import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Every picture on /search goes through here.
 *
 * ── 🔴 WHY THIS IS A CLIENT COMPONENT WHEN THE REST OF THE PAGE IS NOT ─────
 * Owner report (2026-08-24): "some trending now search are showing question
 * mark instead of a thumbnail". That question mark is the browser's
 * broken-image glyph, and the cause is measured, not guessed — HEAD requests
 * against the live thumbnail set come back:
 *
 *     403  https://scontent-iad6-1.xx.fbcdn.net/…      (Facebook, hotlink-blocked)
 *     403  https://p16-common-sign.tiktokcdn-us.com/…  (TikTok, signed URL expired)
 *
 * A post's cover is whatever CDN yt-dlp resolved at download time, and those
 * URLs rot. `components/ui/smart-thumb.tsx` has handled exactly this everywhere
 * else in the app for months; only an `onError` handler can, and `onError` needs
 * a client component. So these image leaves are client — the rails, cards and
 * section shells around them stay server-rendered.
 */
export function SafeImage({
  fallback,
  className,
  // Destructured rather than left in the spread purely so the a11y lint rule
  // can SEE it — it cannot follow an alt that arrives inside `...props`.
  alt,
  ...props
}: Omit<ImageProps, "onError"> & { fallback: ReactNode }) {
  const [broken, setBroken] = useState(false);
  // Reset SYNCHRONOUSLY when the source changes, so a recycled tile never
  // renders one stale frame — the same pattern SmartThumb uses.
  const [lastSrc, setLastSrc] = useState(props.src);
  if (props.src !== lastSrc) {
    setLastSrc(props.src);
    setBroken(false);
  }

  if (!props.src || broken) return <>{fallback}</>;
  return <Image {...props} alt={alt} className={className} onError={() => setBroken(true)} />;
}

/**
 * A round avatar.
 *
 * 🔴 The no-picture case is a PERSON GLYPH on a neutral surface (owner,
 * 2026-08-24: "profiles without profile picture or anything should show a
 * profile icon rather than the black frenz logo"). The suggested-creator cards
 * were falling back to `/brand/frenz-logo-tile.png`, which put a large black
 * Frenz mark where a face belongs and made three different strangers look like
 * the same account.
 */
export function Avatar({
  src,
  size,
  className,
}: {
  src: string | null | undefined;
  size: number;
  className?: string;
}) {
  const placeholder = (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground",
        className,
      )}
    >
      <UserRound style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.75} />
    </span>
  );

  return (
    <SafeImage
      src={src ?? ""}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      fallback={placeholder}
      className={cn("shrink-0 rounded-full bg-secondary object-cover", className)}
    />
  );
}

/** The portrait on a suggested-creator card — same no-picture rule, square-ish. */
export function CreatorPortrait({ src, className }: { src: string | null; className?: string }) {
  const placeholder = (
    <span
      aria-hidden
      className={cn("flex items-center justify-center bg-secondary text-muted-foreground", className)}
    >
      <UserRound className="h-10 w-10" strokeWidth={1.5} />
    </span>
  );
  return (
    <SafeImage
      src={src ?? ""}
      alt=""
      width={128}
      height={160}
      loading="lazy"
      decoding="async"
      fallback={placeholder}
      className={cn("bg-secondary object-cover", className)}
    />
  );
}

/**
 * A video card's cover.
 *
 * 🔴 Owner report (2026-08-24): "some videos are showing blank colored
 * thumbnail, instead of the video cover". Probed against the live table: those
 * posts have `thumbnail_url = NULL` and `stream_uid = NULL` (Cloudflare Stream
 * is not configured on this deployment) — but they DO have an `media_url` mp4.
 * There was never a cover to show; the card was painting its brand-gradient
 * placeholder, which reads as "blank" rather than as "no artwork".
 *
 * So the real first frame is drawn, exactly as `components/social/post-grid.tsx`
 * has always done it — `#t=0.5` with `preload="metadata"`, which fetches the
 * moov atom and one frame, not the video. This is the ONLY `<video>` on the
 * page and it exists solely where a poster is missing (2 of 10 cards today):
 * it never autoplays, has no controls and is not focusable, so it stays a
 * picture. Running `npm run backfill:posters` fixes the DATA and removes even
 * these, at which point every card is a plain image again.
 */
export function VideoCover({
  thumbnailUrl,
  mediaUrl,
  mediaKind,
  sizes,
}: {
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  mediaKind: string;
  sizes: string;
}) {
  const blank = (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-secondary text-muted-foreground">
      <Play className="h-7 w-7 fill-current opacity-40" />
    </span>
  );

  if (thumbnailUrl) {
    return (
      <SafeImage
        src={thumbnailUrl}
        alt=""
        fill
        sizes={sizes}
        loading="lazy"
        fallback={<FirstFrame mediaUrl={mediaUrl} mediaKind={mediaKind} blank={blank} />}
        className="object-cover"
      />
    );
  }
  return <FirstFrame mediaUrl={mediaUrl} mediaKind={mediaKind} blank={blank} />;
}

function FirstFrame({
  mediaUrl,
  mediaKind,
  blank,
}: {
  mediaUrl: string | null;
  mediaKind: string;
  blank: ReactNode;
}) {
  if (mediaKind === "video" && mediaUrl) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- a poster frame, not playback
      <video
        src={`${mediaUrl}#t=0.5`}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (mediaKind === "image" && mediaUrl) {
    return (
      <SafeImage
        src={mediaUrl}
        alt=""
        fill
        sizes="164px"
        loading="lazy"
        fallback={blank}
        className="object-cover"
      />
    );
  }
  return <>{blank}</>;
}
