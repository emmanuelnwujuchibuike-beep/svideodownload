"use client";

import { streamIframeUrl } from "@/lib/media/stream";
import { cn } from "@/lib/utils";

/**
 * One video component for the whole app. If the item has a Cloudflare Stream `uid`,
 * it renders the adaptive-bitrate Stream player (instant start, quality ladder);
 * otherwise it falls back to a normal `<video>` served from R2/Supabase. Swapping a
 * surface over to Stream is just: pass `streamUid` when you have one.
 */
export function SmartVideo({
  streamUid,
  src,
  poster,
  autoPlay,
  controls = true,
  loop,
  muted,
  className,
}: {
  streamUid?: string | null;
  src?: string | null;
  poster?: string | null;
  autoPlay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  className?: string;
}) {
  if (streamUid) {
    const params = new URLSearchParams();
    if (autoPlay) params.set("autoplay", "true");
    if (loop) params.set("loop", "true");
    if (muted || autoPlay) params.set("muted", "true"); // autoplay requires muted
    if (!controls) params.set("controls", "false");
    if (poster) params.set("poster", poster);
    const q = params.toString();
    return (
      <iframe
        src={`${streamIframeUrl(streamUid)}${q ? `?${q}` : ""}`}
        title="Video"
        loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className={cn("h-full w-full border-0", className)}
      />
    );
  }

  if (!src) return null;
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={poster ?? undefined}
      autoPlay={autoPlay}
      controls={controls}
      loop={loop}
      muted={muted || autoPlay}
      playsInline
      className={cn("h-full w-full", className)}
    />
  );
}
