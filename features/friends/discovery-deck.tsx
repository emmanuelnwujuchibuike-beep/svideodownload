"use client";

import { BadgeCheck, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FadeImage } from "@/features/ui/fade-image";
import { muteInstant, unmuteWithFade } from "@/lib/media/audio-playback";
import { getApi } from "@/lib/sdk/browser";
import type { DiscoveryItem, DiscoveryResult } from "@/lib/social/discovery";
import { cn } from "@/lib/utils";

/**
 * Full-screen, TikTok-style continuous deck for the Friends → Discover grid.
 * Tapping any tile opens straight into this — vertical swipe through every
 * other video/photo in the grid (loading more as the viewer nears the end),
 * instead of leaving the grid to view one post alone.
 */
export function DiscoveryDeck({
  initialItems,
  initialOffset,
  startId,
  onClose,
}: {
  initialItems: DiscoveryItem[];
  initialOffset: number | null;
  startId: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <Deck initialItems={initialItems} initialOffset={initialOffset} startId={startId} onClose={onClose} />,
    document.body,
  );
}

function Deck({
  initialItems,
  initialOffset,
  startId,
  onClose,
}: {
  initialItems: DiscoveryItem[];
  initialOffset: number | null;
  startId: string;
  onClose: () => void;
}) {
  // Reorder so the tapped tile is first — the deck then always opens at index
  // 0, no post-mount scroll-jump to a later slide (same trick /reels uses).
  const [items, setItems] = useState<DiscoveryItem[]>(() => {
    const idx = initialItems.findIndex((i) => i.id === startId);
    if (idx <= 0) return initialItems;
    const copy = initialItems.slice();
    const chosen = copy.splice(idx, 1)[0];
    if (!chosen) return initialItems;
    copy.unshift(chosen);
    return copy;
  });
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(initialOffset);
  const seen = useRef(new Set(initialItems.map((i) => i.id)));
  const loadingMore = useRef(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    // overflowY only — see media-carousel.tsx: the shorthand also resets
    // overflow-x, undoing the app sidebar's overflow-x:clip fix.
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || offset === null) return;
    loadingMore.current = true;
    try {
      const d = await getApi().action<DiscoveryResult>("/api/discovery", {
        method: "GET",
        query: { offset, limit: 12 },
      });
      const fresh = (d.items ?? []).filter((i) => !seen.current.has(i.id));
      for (const i of fresh) seen.current.add(i.id);
      if (fresh.length) setItems((prev) => [...prev, ...fresh]);
      setOffset(d.nextOffset ?? null);
    } catch {
      setOffset(null);
    } finally {
      loadingMore.current = false;
    }
  }, [offset]);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || el.clientHeight === 0) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / el.clientHeight)));
      setActive(i);
      if (i >= items.length - 3) void loadMore();
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className="fixed inset-0 z-[140] bg-black">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, i) => (
          <DiscoverySlide key={it.id} item={it} isActive={i === active} />
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-40 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function DiscoverySlide({ item, isActive }: { item: DiscoveryItem; isActive: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || item.mediaKind !== "video") return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = 0;
      if (!v.muted) {
        muteInstant(v);
        setIsMuted(true);
      }
    }
  }, [isActive, item.mediaKind]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted) {
      unmuteWithFade(v);
      setIsMuted(false);
    } else {
      muteInstant(v);
      setIsMuted(true);
    }
  };

  return (
    <section className="relative flex h-[100dvh] w-full snap-start snap-always items-center justify-center bg-black">
      {/* blurred fill behind the letterbox, matching the feed album carousel */}
      {item.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbnailUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
      ) : null}

      {item.mediaKind === "video" && item.mediaUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          src={item.mediaUrl}
          poster={item.thumbnailUrl ?? undefined}
          muted
          loop
          playsInline
          preload={isActive ? "auto" : "metadata"}
          onClick={toggleMute}
          className="relative h-full w-full object-contain"
        />
      ) : (
        <div className="relative h-full w-full">
          <FadeImage
            src={item.mediaUrl ?? item.thumbnailUrl ?? ""}
            alt=""
            fill
            sizes="100vw"
            className="object-contain"
            loading={isActive ? "eager" : "lazy"}
          />
        </div>
      )}

      {item.mediaKind === "video" ? (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 active:scale-95"
        >
          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/25 to-transparent p-4",
          "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        )}
      >
        <Link href={`/u/${item.handle}`} className="pointer-events-auto flex w-fit items-center gap-2">
          {item.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white ring-2 ring-white/20">
              {item.displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="flex items-center gap-1 text-sm font-semibold text-white drop-shadow">
            {item.displayName}
            {item.isVerified ? <BadgeCheck className="h-3.5 w-3.5" /> : null}
          </span>
        </Link>
        {item.title ? (
          <p className="pointer-events-auto mt-1.5 line-clamp-2 text-sm text-white/90 drop-shadow">{item.title}</p>
        ) : null}
        <Link
          href={`/p/${item.id}`}
          className="pointer-events-auto mt-2 inline-block text-xs font-semibold text-white/75 underline underline-offset-2 hover:text-white"
        >
          View post
        </Link>
      </div>
    </section>
  );
}
