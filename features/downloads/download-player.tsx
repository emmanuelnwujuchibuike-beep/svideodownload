"use client";

import { AlertCircle, Check, Download, ExternalLink, Globe2, Heart, Link2, Loader2, MessageCircle, MoreVertical, Play, Rewind, FastForward, Share2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getMedia, mediaKey, saveMedia } from "@/features/downloads/local-media";
import { closePlayer, playerNext, playerPrev, usePlayerQueue } from "@/features/downloads/player-store";
import { SendToChatSheet } from "@/features/downloads/send-to-chat-sheet";
import { removeDownload, toggleFavorite } from "@/features/history/store";
import { toast } from "@/features/ui/toast";
import { downloadUrl, saveToDevice } from "@/lib/client-download";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { presignUpload, uploadWithPlan, type UploadPlan } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

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
  const [sendToChatOpen, setSendToChatOpen] = useState(false);
  const [favorited, setFavorited] = useState(rec.favorite);
  const [savedToDevice, setSavedToDevice] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100 within the CURRENT item, for the status bar
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Transient "−10s / +10s" pill shown on a double-tap seek (the top segmented bar
  // already signals prev/next, so no separate nav flash is needed). Auto-clears.
  const [seekFlash, setSeekFlash] = useState<-1 | 1 | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Pending single-tap on a side zone, held ~260ms so a second tap on the same
  // side upgrades it to a double-tap seek instead of firing prev/next.
  const tapRef = useRef<{ side: "left" | "right"; timer: number } | null>(null);
  const flashTimer = useRef<number | null>(null);
  // Prefetched the moment the ••• sheet opens (real signal of intent to maybe
  // publish) — by the time "Publish to everyone" is actually tapped, the
  // presign round-trip and the auth check are usually already resolved, so
  // only the real network-bound part (the upload itself) remains on the
  // critical path. Best-effort: `publish()` falls back to fetching both
  // fresh if either prefetch hasn't landed yet or (rare — the sheet stayed
  // open a long time) the presigned URL has since expired.
  const planRef = useRef<UploadPlan | null>(null);
  const authUserRef = useRef<{ id: string } | null>(null);

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

    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      document.body.style.overflowY = "";
    };
  }, [rec]);

  // Fires as soon as the options sheet opens — not on mount — so a video the
  // viewer never opens the menu for never triggers a wasted presign/auth call.
  useEffect(() => {
    if (!moreOpen || postId) return;
    if (!planRef.current) {
      const ext = rec.kind === "audio" ? "mp3" : rec.kind === "image" ? "jpg" : "mp4";
      presignUpload(rec.kind, ext)
        .then((p) => { planRef.current = p; })
        .catch(() => {});
    }
    if (!authUserRef.current) {
      createClient()
        .auth.getUser()
        .then(({ data }) => { if (data.user) authUserRef.current = data.user; })
        .catch(() => {});
    }
  }, [moreOpen, postId, rec.kind]);

  const publish = async () => {
    const blob = blobRef.current;
    if (!blob || publishing) return;
    setPublishing(true);
    const tid = toast("Publishing for everyone…", "loading");
    try {
      const user = authUserRef.current ?? (await createClient().auth.getUser()).data.user;
      if (!user) {
        toast("Please sign in.", "error", { id: tid, duration: 3000 });
        return;
      }
      const ext = rec.kind === "audio" ? "mp3" : rec.kind === "image" ? "jpg" : "mp4";
      const contentType = blob.type || (rec.kind === "audio" ? "audio/mpeg" : rec.kind === "image" ? "image/jpeg" : "video/mp4");
      let publicUrl: string;
      try {
        // Main media → Cloudflare R2 when configured, else Supabase. Use the
        // plan prefetched when the sheet opened if we have one (skips the
        // presign round-trip); if it's missing or has since expired (short-
        // lived R2 URLs), fall back to requesting + using a fresh one.
        const prefetched = planRef.current;
        planRef.current = null;
        publicUrl = prefetched
          ? await uploadWithPlan(prefetched, blob, contentType).catch(async () =>
              uploadWithPlan(await presignUpload(rec.kind, ext), blob, contentType),
            )
          : await uploadWithPlan(await presignUpload(rec.kind, ext), blob, contentType);
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

  /** Hand the file to the device right from the preview. Uses `saveToDevice`
   *  (the iOS-aware share-sheet path), reading the blob we already have in memory
   *  or the on-device library — no re-download. */
  const saveToDeviceNow = async () => {
    const blob = blobRef.current ?? (await getMedia(mediaKey(rec.url, rec.formatId, rec.kind)).catch(() => null));
    if (!blob) {
      toast("Still preparing — try again in a moment.", "error");
      return;
    }
    const ext = rec.kind === "audio" ? "mp3" : rec.kind === "image" ? "jpg" : "mp4";
    try {
      await saveToDevice(blob, `${rec.title || "download"}.${ext}`);
      setSavedToDevice(true);
      setTimeout(() => setSavedToDevice(false), 2000);
    } catch {
      /* the share sheet was cancelled — nothing to report */
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

  /* ── Playback controls — iOS-gallery / WhatsApp-status gestures (owner spec) ──
   *  On a full-screen video:
   *    • tap LEFT third   → previous clip   · double-tap LEFT  → −10s
   *    • tap CENTER third → play / pause
   *    • tap RIGHT third  → next clip        · double-tap RIGHT → +10s
   *  On an image, left/right jump prev/next instantly (no seek). A clip also
   *  auto-advances when it ends. Keyboard mirrors this (Space / ← / → / Esc).
   */
  const SEEK_STEP = 10;
  const DOUBLE_TAP_MS = 260;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };
  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(v.duration || t, t));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  };
  const seekBy = (delta: number) => seekTo((videoRef.current?.currentTime ?? currentTime) + delta);

  const doSeek = (dir: -1 | 1) => {
    seekBy(dir * SEEK_STEP);
    haptic("light");
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setSeekFlash(dir);
    flashTimer.current = window.setTimeout(() => {
      setSeekFlash(null);
      flashTimer.current = null;
    }, 550);
  };
  const goPrev = () => {
    if (index === 0) return;
    haptic("light");
    playerPrev();
  };
  const goNext = () => {
    if (index >= total - 1) return; // tap never dismisses; only a finished clip advances past the end
    haptic("light");
    playerNext();
  };

  /** A tap on a side zone. Images jump instantly; video waits ~260ms so a second
   *  tap on the same side upgrades to a ±10s seek instead of prev/next. */
  const onSideTap = (side: "left" | "right") => {
    if (rec.kind !== "video") {
      side === "left" ? goPrev() : goNext();
      return;
    }
    const pending = tapRef.current;
    if (pending && pending.side === side) {
      window.clearTimeout(pending.timer);
      tapRef.current = null;
      doSeek(side === "left" ? -1 : 1);
      return;
    }
    if (pending) window.clearTimeout(pending.timer);
    const timer = window.setTimeout(() => {
      tapRef.current = null;
      side === "left" ? goPrev() : goNext();
    }, DOUBLE_TAP_MS);
    tapRef.current = { side, timer };
  };

  // Clear any pending tap/flash timers on unmount so they never fire late.
  useEffect(() => {
    return () => {
      if (tapRef.current) window.clearTimeout(tapRef.current.timer);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // Keyboard: Escape closes; Space toggles; ← / → seek 10s; on non-video ← / →
  // move between clips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closePlayer();
      if (e.key === " " && rec.kind === "video") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        rec.kind === "video" ? doSeek(1) : goNext();
      } else if (e.key === "ArrowLeft") {
        rec.kind === "video" ? doSeek(-1) : goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.kind, index, total]);

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={rec.title}>
      {/* Status — segmented, like Stories/WhatsApp: one bar per queued item, the
          current one fills with real playback progress (a non-video item reads as
          complete). Always shown — a single segment for a lone clip — so even one
          video gets a status-style progress line. Cleared of the safe area
          (Dynamic Island / status bar) via var(--frenz-safe-top). */}
      <div className="absolute inset-x-3 top-[calc(0.5rem+var(--frenz-safe-top))] z-20 flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full rounded-full bg-white"
              style={{ width: `${i < index ? 100 : i === index ? (rec.kind === "video" ? progress : 100) : 0}%` }}
            />
          </span>
        ))}
      </div>

      {/* X (dismiss) and ••• (menu) sit on OPPOSITE top corners, both below the
          safe area so they never jam under the island. */}
      <button
        type="button"
        onClick={closePlayer}
        aria-label="Close"
        className="fixed left-4 top-[calc(1.75rem+var(--frenz-safe-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
      >
        <X className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="More options"
        className="fixed right-4 top-[calc(1.75rem+var(--frenz-safe-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/* Title / position */}
      <p className="pointer-events-none absolute inset-x-16 top-[calc(2rem+var(--frenz-safe-top))] z-10 truncate text-center text-sm font-medium text-white/90">
        {rec.title}
        {total > 1 ? <span className="text-white/60"> · {index + 1}/{total}</span> : null}
      </p>

      {/* The stage — full-bleed media. object-contain never crops the width or
          over-stretches beyond the source: it letterboxes on black and extends into
          the safe area (owner: "full screen … to the safe area but never crop off
          the width, never stretch more than it can"). iOS-gallery tap zones sit over
          the media, under the chrome. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {error ? (
          <div className="max-w-sm px-6 text-center text-white">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><AlertCircle className="h-7 w-7" /></span>
            <p className="text-lg font-semibold">Couldn&apos;t load this video</p>
            <p className="mt-1 text-sm text-white/70">The source may be unavailable. Try again later.</p>
          </div>
        ) : cachePct !== null && !url ? (
          <div className="w-full max-w-xs px-6 text-center text-white">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/70" />
            <p className="mt-3 text-sm font-medium">Loading video… {cachePct}%</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${cachePct}%` }} /></div>
          </div>
        ) : loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        ) : url && rec.kind === "audio" ? (
          <div className="mx-4 w-full max-w-md rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 p-8 text-white">
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
          <img src={url} alt={rec.title} className="h-full w-full object-contain" />
        ) : url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={url}
            autoPlay
            playsInline
            className="h-full w-full bg-black object-contain"
            onEnded={() => playerNext()}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setCurrentTime(v.currentTime);
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        ) : null}

        {/* iOS-gallery / WhatsApp-status tap zones — over the media, UNDER the chrome
            (z-10/20) so the X, •••, status bar and Save button stay tappable. Video
            gets three thirds (prev · play-pause · next); an image gets two halves
            (prev · next). touch-manipulation kills mobile double-tap-to-zoom so a
            fast double-tap on a side reliably registers as a ±10s seek. */}
        {url && !error && rec.kind !== "audio" ? (
          <div className="absolute inset-0 z-[5] flex select-none [touch-action:manipulation]">
            <button
              type="button"
              aria-label={rec.kind === "video" ? "Previous clip; double-tap to rewind 10 seconds" : "Previous"}
              onClick={() => onSideTap("left")}
              className="h-full flex-1 outline-none"
            />
            {rec.kind === "video" ? (
              <button type="button" aria-label="Play or pause" onClick={togglePlay} className="h-full flex-1 outline-none" />
            ) : null}
            <button
              type="button"
              aria-label={rec.kind === "video" ? "Next clip; double-tap to forward 10 seconds" : "Next"}
              onClick={() => onSideTap("right")}
              className="h-full flex-1 outline-none"
            />
          </div>
        ) : null}

        {/* Big Play glyph while paused (video). Above the tap zones so it isn't dimmed. */}
        {paused && rec.kind === "video" && url ? (
          <span className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
              <Play className="ml-0.5 h-7 w-7 fill-white" />
            </span>
          </span>
        ) : null}

        {/* Double-tap seek feedback — a "−10s / +10s" pill on the tapped side. */}
        {seekFlash !== null ? (
          <motion.span
            key={`${seekFlash}-${currentTime.toFixed(1)}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springs.press}
            className={cn(
              "pointer-events-none absolute top-1/2 z-[6] flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-4 py-2 text-sm font-bold text-white backdrop-blur",
              seekFlash === -1 ? "left-6" : "right-6",
            )}
          >
            {seekFlash === -1 ? <Rewind className="h-4 w-4 fill-white" /> : <FastForward className="h-4 w-4 fill-white" />}
            10s
          </motion.span>
        ) : null}
      </div>

      {/* Bottom controls: just the elapsed/duration readout and Save to device now
          — navigation and seeking are the tap-zone gestures on the media itself, so
          there is no scrubber competing with the content (Stories/Reels-style). The
          strip is pointer-events-none so taps around the button still reach the tap
          zones; the button itself is pointer-events-auto. */}
      {url && !error ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {rec.kind === "video" && duration > 0 ? (
            <span className="rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={saveToDeviceNow}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-elevated transition active:scale-95"
          >
            {savedToDevice ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" /> Saved
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Save to device
              </>
            )}
          </button>
        </div>
      ) : null}

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
                      <MenuItem icon={MessageCircle} label="Send to chat" onClick={() => { setMoreOpen(false); setSendToChatOpen(true); }} />
                      <MenuItem icon={Download} label="Save to device" onClick={() => { setMoreOpen(false); void saveToDeviceNow(); }} />
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

      <SendToChatSheet
        open={sendToChatOpen}
        onClose={() => setSendToChatOpen(false)}
        blob={blobRef.current}
        // `blobRef` is only populated once this player has fully buffered the
        // file, so it's null for a download opened from an earlier session (or
        // if Send is tapped while it's still streaming). That made "Send to
        // chat" a silent no-op — owner, 2026-07-16. Every completed download
        // already lives in the local media cache, so hand the sheet a way to
        // fetch it on demand instead of depending on this ref being warm.
        resolveBlob={async () => getMedia(mediaKey(rec.url, rec.formatId, rec.kind)).catch(() => null)}
        kind={rec.kind}
        title={rec.title || "Shared media"}
        thumbnailUrl={rec.thumbnail ?? null}
        prefetchedPlan={planRef.current}
      />
    </div>
  );
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
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
