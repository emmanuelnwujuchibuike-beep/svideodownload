"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { FeedVideo } from "@/features/media/feed-video";
import { ImageViewer } from "@/features/feed/image-viewer";
import { ReelViewer } from "@/features/feed/reel-viewer";
import { MediaCarousel } from "@/features/media/media-carousel";
import { SmartVideo } from "@/features/media/smart-video";
import type { FeedItem } from "@/lib/social/home-feed";

/**
 * The post page's hero media. A video plays inline (autoplays muted in view) and
 * opens a full-screen, reel-quality viewer — with comments, reactions, gestures —
 * so people (including the owner) can watch their own post like TikTok/Facebook.
 * Images open in a zoom lightbox. Never a bare black box.
 */
export function PostMedia({ item }: { item: FeedItem }) {
  const [reel, setReel] = useState(false);
  const [reelSlide, setReelSlide] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [imageSlide, setImageSlide] = useState(0);

  const isVideo = item.mediaKind === "video" && (item.mediaUrl || item.streamUid);
  const isImage = item.mediaKind === "image" && (item.mediaUrl || item.thumbnailUrl);

  // Album post → the full swipeable carousel (counter, dots, in-view video
  // autoplay), never just the cover. Tapping any slide opens the EXACT one
  // tapped, in fullscreen, still swipeable through every other item — an
  // all-video album opens the reel-quality viewer (seeded on that video); a
  // photo-only or MIXED album opens the same rich immersive viewer photos
  // get elsewhere, which renders every slide in order regardless of kind.
  if (item.mediaItems && item.mediaItems.length > 1) {
    const allVideo = item.mediaItems.every((m) => m.kind === "video");
    return (
      <>
        <div className="overflow-hidden rounded-3xl border border-border/60 bg-black shadow-card">
          <MediaCarousel
            items={item.mediaItems}
            onExpandItem={(index) => {
              // An all-video album's slide indices line up with the reel
              // viewer's own (video-only) album model; anything with even one
              // photo goes through the image viewer instead, whose swipe
              // stage indexes the FULL mixed array correctly regardless of
              // which slide (photo or video) was actually tapped.
              if (allVideo) {
                setReelSlide(index);
                setReel(true);
              } else {
                setImageSlide(index);
                setZoom(true);
              }
            }}
          />
        </div>
        {zoom ? <ImageViewer item={item} startIndex={imageSlide} onClose={() => setZoom(false)} /> : null}
        <ReelViewer items={reel ? [item] : null} startIndex={0} startSlideIndex={reelSlide} onClose={() => setReel(false)} />
      </>
    );
  }

  if (isVideo) {
    return (
      <>
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-black shadow-card">
          {item.mediaUrl ? (
            <FeedVideo
              src={item.mediaUrl}
              streamUid={item.streamUid}
              streamReady={item.streamReady}
              streamFailed={item.streamFailed}
              poster={item.thumbnailUrl}
              postId={item.id}
              onExpand={() => setReel(true)}
              className="aspect-video w-full lg:aspect-auto lg:max-h-[78vh]"
            />
          ) : (
            <div className="aspect-video w-full">
              <SmartVideo streamUid={item.streamUid} poster={item.thumbnailUrl} controls className="h-full w-full" />
            </div>
          )}
          {/* No extra "Full screen" pill: FeedVideo now carries the real
              fullscreen control, and a tap already opens the reel viewer —
              two overlapping bottom-right affordances read as a glitch. */}
        </div>
        <ReelViewer items={reel ? [item] : null} startIndex={0} onClose={() => setReel(false)} />
      </>
    );
  }

  if (isImage) {
    const src = item.mediaUrl || item.thumbnailUrl!;
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} aria-label="View image" className="relative block w-full overflow-hidden rounded-3xl border border-border/60 bg-neutral-950 shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={item.title} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={item.title} className="relative mx-auto max-h-[78vh] w-auto max-w-full object-contain" />
        </button>
        {zoom ? <ImageZoom src={src} onClose={() => setZoom(false)} /> : null}
      </>
    );
  }

  // External download-only reference (no re-hosted media) → premium cover preview.
  return (
    <div className="relative aspect-video overflow-hidden rounded-3xl border border-border/60 bg-neutral-950 shadow-card">
      {item.thumbnailUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt={item.title} className="absolute inset-0 h-full w-full object-contain" />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/25">
          <Play className="h-14 w-14" />
        </div>
      )}
    </div>
  );
}

function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[92vh] max-w-full rounded-xl object-contain shadow-2xl" />
    </div>
  );
}
