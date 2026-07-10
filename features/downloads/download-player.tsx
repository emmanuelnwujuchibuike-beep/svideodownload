"use client";

import { AlertCircle, Download, ExternalLink, Globe2, Heart, Link2, Loader2, MoreVertical, Pause, Share2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getMedia, mediaKey, saveMedia } from "@/features/downloads/local-media";
import { closePlayer, playerNext, playerPrev, usePlayerQueue } from "@/features/downloads/player-store";
import { removeDownload, toggleFavorite } from "@/features/history/store";
import { toast } from "@/features/ui/toast";
import { downloadUrl, saveBlob } from "@/lib/client-download";
import { springs } from "@/lib/motion/springs";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

// A tap only counts if the pointer barely moved (matches FeedVideo/reel-viewer's
// tap-vs-drag tolerance so the gesture language is consistent everywhere).
const TAP_MOVE_TOLERANCE = 18;
const HOLD_MS = 300;

export function DownloadPlayer() {
  const queue = usePlayerQueue();
  const rec = queue?.items[queue.index];
  if (!queue || !rec) return null;
  return <PlayerInner key={rec.id} rec={rec} index={queue.index} total={queue.items.length} />;
}

/**
 * Stories-style sequential player (owner spec): tap right/left to move
 * through the queue (Continue Watching's row), auto-advance when a video
 * ends, press-and-hold to pause, a segmented status bar up top instead of a
 * scrubber, and every action folded into the ••• menu — no persistent bottom
 * action bar competing with the content the way Stories/Reels never do.
 */
function PlayerInner({ rec, index, total }: { rec: DownloadRecord; index: number; total: number }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cachePct, setCachePct] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [favorited, setFavorited] = useState(rec.favorite);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100 within the CURRENT item, for the status bar
  const blobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    const controller = new AbortController();

    const play = (blob: Blob) => {
      blobRef.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      setLoading(false);
      setCachePct(null);
    };

    (async () => {
      const key = mediaKey(rec.url, rec.formatId, rec.kind);
      const cached = await getMedia(key);
      if (!alive) return;
      if (cached) return play(cached);

      // Not cached yet → stream it once for in-browser playback, then store it.
      setCachePct(0);
      try {
        const res = await fetch(downloadUrl({ url: rec.url, formatId: rec.formatId, kind: rec.kind, title: rec.title }), { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error();
        const total = Number(res.headers.get("content-length")) || 0;
        const ct = res.headers.get("content-type") || "video/mp4";
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            if (total && alive) setCachePct(Math.min(99, Math.round((received / total) * 100)));
          }
        }
        if (!alive) return;
        const blob = new Blob(chunks as BlobPart[], { type: ct });
        void saveMedia(key, blob);
        play(blob);
      } catch {
        if (alive && !controller.signal.aborted) {
          setError(true);
          setLoading(false);
          setCachePct(null);
        }
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlayer();
      else if (e.key === "ArrowRight") playerNext();
      else if (e.key === "ArrowLeft") playerPrev();
    };
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
    };
  }, [rec]);

  const publish = async () => {
    const blob = blobRef.current;
    if (!blob || publishing) return;
    setPublishing(true);
    const tid = toast("Publishing for everyone…", "loading");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast("Please sign in.", "error", { id: tid, duration: 3000 });
        return;
      }
      const ext = rec.kind === "audio" ? "mp3" : rec.kind === "image" ? "jpg" : "mp4";
      let publicUrl: string;
      try {
        // Main media → Cloudflare R2 when configured, else Supabase.
        publicUrl = await uploadPostMedia({
          data: blob,
          kind: rec.kind,
          ext,
          contentType: blob.type || (rec.kind === "audio" ? "audio/mpeg" : rec.kind === "image" ? "image/jpeg" : "video/mp4"),
        });
      } catch {
        toast("Upload failed.", "error", { id: tid, duration: 3000 });
        return;
      }
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: publicUrl, mediaKind: rec.kind, title: rec.title, thumbnailUrl: rec.thumbnail, sourceUrl: rec.url }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't publish.", "error", { id: tid, duration: 3500 });
        return;
      }
      setPostId(json.postId as string);
      toast("Published! Everyone can watch it online.", "success", { id: tid, duration: 3500 });
    } catch {
      toast("Network error.", "error", { id: tid, duration: 3000 });
    } finally {
      setPublishing(false);
    }
  };

  const share = async () => {
    if (!postId) return;
    const link = `${window.location.origin}/p/${postId}`;
    try {
      if (navigator.share) await navigator.share({ title: rec.title, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Link copied.", "success", { duration: 2000 });
      }
    } catch {
      /* cancelled */
    }
  };

  const copyLink = async () => {
    setMoreOpen(false);
    try {
      await navigator.clipboard.writeText(rec.url);
      toast("Source link copied.", "success", { duration: 2000 });
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };
  const openOriginal = () => {
    setMoreOpen(false);
    window.open(rec.url, "_blank", "noopener");
  };
  // Re-opens the downloader on this same source with the full quality picker,
  // so a video that won't play at this quality can be re-downloaded at another.
  const chooseAnotherQuality = () => {
    setMoreOpen(false);
    closePlayer();
    router.push(`/downloads?u=${encodeURIComponent(rec.url)}`);
  };
  const toggleFav = () => {
    setMoreOpen(false);
    const next = !favorited;
    setFavorited(next);
    toggleFavorite(rec.id);
  };
  const removeFromHistory = () => {
    setMoreOpen(false);
    removeDownload(rec.id);
    closePlayer();
    toast("Removed from downloads.", "info", { duration: 2000 });
  };

  /* ── Gesture model (Stories-style, owner spec) ────────────────────────────
   *  • tap left third   → previous item
   *  • tap right (rest) → next item
   *  • press-and-hold   → pause (video only); release resumes
   *  • video ends       → auto-advance, same as finishing a Story
   * Guarded so a graze/drag never fires a navigation. */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const moved = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);

  const resumePlay = () => {
    setPaused(false);
    void videoRef.current?.play().catch(() => {});
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startPt.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    holding.current = false;
    if (rec.kind !== "video") return;
    holdTimer.current = setTimeout(() => {
      if (moved.current) return;
      holding.current = true;
      videoRef.current?.pause();
      setPaused(true);
    }, HOLD_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || moved.current) return;
    if (Math.abs(e.clientX - startPt.current.x) > TAP_MOVE_TOLERANCE || Math.abs(e.clientY - startPt.current.y) > TAP_MOVE_TOLERANCE) {
      moved.current = true;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (holding.current) {
        holding.current = false;
        resumePlay();
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      resumePlay();
      return;
    }
    if (moved.current) return; // a drag, not a tap — no navigation
    const w = typeof window !== "undefined" ? window.innerWidth : 1;
    if (e.clientX < w * 0.33) playerPrev();
    else playerNext();
  };
  const onPointerCancel = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      resumePlay();
    }
    startPt.current = null;
  };

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={rec.title}>
      {/* Status — segmented, like Stories: one bar per queued item, the
          current one fills with real playback progress. */}
      {total > 1 ? (
        <div className="absolute inset-x-3 top-3 z-20 flex gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <span className="block h-full rounded-full bg-white" style={{ width: `${i < index ? 100 : i === index ? progress : 0}%` }} />
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={closePlayer}
        aria-label="Close"
        className={cn("fixed left-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur", total > 1 ? "top-8" : "top-4")}
      >
        <X className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="More options"
        className={cn("fixed right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur", total > 1 ? "top-8" : "top-4")}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/* Title / position — where the status bar used to have nothing above it */}
      <p className={cn("pointer-events-none absolute inset-x-16 z-10 truncate text-center text-sm font-medium text-white/90", total > 1 ? "top-9" : "top-5")}>
        {rec.title}
        {total > 1 ? <span className="text-white/60"> · {index + 1}/{total}</span> : null}
      </p>

      {/* Tap zones (prev/next) + hold-to-pause cover the whole stage */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {error ? (
          <div className="max-w-sm text-center text-white">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><AlertCircle className="h-7 w-7" /></span>
            <p className="text-lg font-semibold">Couldn&apos;t load this video</p>
            <p className="mt-1 text-sm text-white/70">The source may be unavailable. Try again later.</p>
          </div>
        ) : cachePct !== null && !url ? (
          <div className="w-full max-w-xs text-center text-white">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/70" />
            <p className="mt-3 text-sm font-medium">Loading video… {cachePct}%</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${cachePct}%` }} /></div>
          </div>
        ) : loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        ) : url && rec.kind === "audio" ? (
          <div className="w-full max-w-md rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 p-8 text-white">
            {rec.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rec.thumbnail} alt="" className="mx-auto mb-5 h-40 w-40 rounded-2xl object-cover" />
            ) : null}
            <p className="mb-3 text-center font-semibold">{rec.title}</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        ) : url && rec.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={rec.title} className="max-h-full max-w-full rounded-2xl object-contain" />
        ) : url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={url}
            autoPlay
            playsInline
            className="max-h-full w-full max-w-4xl rounded-2xl bg-black"
            onEnded={() => playerNext()}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        ) : null}

        {/* Paused-while-holding indicator — same convention as FeedVideo/reels */}
        {paused ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
              <Pause className="h-7 w-7 fill-white" />
            </span>
          </span>
        ) : null}
      </div>

      {/* Options (•••) — every action lives here now; no persistent bottom bar. */}
      <AnimatePresence>
        {moreOpen ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center">
            <motion.button
              type="button"
              aria-label="Close"
              onClick={() => setMoreOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              role="menu"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={springs.sheet}
              className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
            >
              <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-border" />
              <div className="p-1.5">
                <div className="mb-1.5 overflow-hidden rounded-2xl bg-secondary/30">
                  {url && !error ? (
                    <>
                      {postId ? (
                        <MenuItem icon={Share2} label="Share" onClick={() => { setMoreOpen(false); void share(); }} />
                      ) : (
                        <MenuItem icon={Globe2} label={publishing ? "Publishing…" : "Publish to everyone"} onClick={() => { if (!publishing) void publish(); }} />
                      )}
                      <MenuItem icon={Download} label="Save to device" onClick={() => { setMoreOpen(false); blobRef.current && saveBlob(blobRef.current, rec.title || "download"); }} />
                    </>
                  ) : null}
                  <MenuItem icon={Heart} label={favorited ? "Unfavorite" : "Favorite"} active={favorited} onClick={toggleFav} />
                  {rec.kind === "video" ? (
                    <MenuItem icon={Download} label="Choose a different quality" onClick={chooseAnotherQuality} />
                  ) : null}
                  <MenuItem icon={Link2} label="Copy source link" onClick={copyLink} />
                  <MenuItem icon={ExternalLink} label="Open original post" onClick={openOriginal} />
                </div>
                <div className="overflow-hidden rounded-2xl bg-secondary/30">
                  <MenuItem icon={Trash2} label="Remove from downloads" onClick={removeFromHistory} danger />
                </div>
              </div>
              <div className="p-1.5 pt-0">
                <button type="button" onClick={() => setMoreOpen(false)} className="w-full rounded-2xl bg-secondary/70 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary active:scale-[0.99]">
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-3.5 px-4 py-3 text-left text-[15px] font-medium transition first:rounded-t-2xl last:rounded-b-2xl active:scale-[0.99]",
        danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-secondary/70",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0 opacity-90", active && "fill-rose-500 text-rose-500")} strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
