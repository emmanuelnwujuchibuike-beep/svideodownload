"use client";

import { AlertCircle, Check, Download, ExternalLink, Globe2, Heart, Link2, Loader2, MessageCircle, MoreVertical, Play, Share2, Trash2, X } from "lucide-react";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { getMedia, mediaKey, saveMedia } from "@/features/downloads/local-media";
import {
  closePlayer,
  playerAdDone,
  playerClipEnded,
  playerNext,
  playerPrev,
  usePlayerAdPending,
  usePlayerQueue,
} from "@/features/downloads/player-store";
import { StoryAdSlide } from "@/features/monetization/story-ad-slide";
import { SendToChatSheet } from "@/features/downloads/send-to-chat-sheet";
import { removeDownload, toggleFavorite } from "@/features/history/store";
import { toast } from "@/features/ui/toast";
import { downloadUrl, saveToDevice } from "@/lib/client-download";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { presignUpload, uploadWithPlan, type UploadPlan } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

/** Warm a record's media into the on-device cache WITHOUT displaying it, so the
 *  next/previous clip in the queue plays instantly (owner: the next video should
 *  "never load at all or show loading"). Best-effort and no-op when already cached. */
async function prefetchMedia(rec: DownloadRecord): Promise<void> {
  try {
    const key = mediaKey(rec.url, rec.formatId, rec.kind);
    if (await getMedia(key)) return; // already on device
    const res = await fetch(downloadUrl({ url: rec.url, formatId: rec.formatId, kind: rec.kind, title: rec.title }));
    if (!res.ok) return;
    const blob = await res.blob();
    void saveMedia(key, blob);
  } catch {
    /* best-effort warm-up — the item still streams on demand if this fails */
  }
}

export function DownloadPlayer() {
  const queue = usePlayerQueue();
  /*
    A story ad is HOLDING the advance (history only — see openPlayerQueueWithAds).
    Rendered as an overlay on top of the still-mounted player rather than as a
    queue entry, so the queue index keeps meaning exactly what every consumer of
    this store already assumes it means.
  */
  const adPending = usePlayerAdPending();
  const [storyAdFilled, setStoryAdFilled] = useState<boolean | null>(null);
  /*
    An unseeded zone must not strand the visitor on a black screen between two
    of their own downloads: the moment the slot reports no creative, the advance
    it was holding is completed.
  */
  useEffect(() => {
    if (adPending && storyAdFilled === false) playerAdDone();
  }, [adPending, storyAdFilled]);
  useEffect(() => {
    if (!adPending) setStoryAdFilled(null);
  }, [adPending]);
  const rec = queue?.items[queue.index];

  // Preload the neighbours (next first, then previous) a beat after the current
  // clip is showing, so swiping through history is instant. Skipped on a slow /
  // data-saver connection so a low-end device never over-fetches (owner's perf rule).
  useEffect(() => {
    if (!queue || isSlowConnection()) return;
    const { items, index } = queue;
    const next = items[index + 1];
    const prev = items[index - 1];
    const id = window.setTimeout(() => {
      if (next) void prefetchMedia(next);
      if (prev) void prefetchMedia(prev);
    }, 500);
    return () => window.clearTimeout(id);
  }, [queue]);

  if (!queue || !rec) return null;
  return (
    <>
      <PlayerInner key={rec.id} rec={rec} index={queue.index} total={queue.items.length} />
      {/*
        The story ad sits OVER the player rather than replacing it, so the clip
        underneath keeps its position and resumes exactly where it was. Rendered
        here in the outer component because this is where the ad state lives —
        PlayerInner is keyed per record and would remount the ad on every
        advance.
      */}
      {adPending ? (
        <StoryAdSlide zone="history_story_ad" onNext={playerAdDone} onResolved={setStoryAdFilled} />
      ) : null}
    </>
  );
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
  /*
    The full caption, on demand (owner, 2026-08-09: the grid should show "one
    line with three dots … for see more that opens the media and caption").

    Clamping the grid tile is only half of it — the "…more" cue has to lead
    somewhere, and this player was truncating the caption too, so the rest was
    unreachable from anywhere in the app. Collapsed by default: this is chrome
    over the media, and a TikTok caption can be several hundred characters.
  */
  const [captionOpen, setCaptionOpen] = useState(false);
  const [sendToChatOpen, setSendToChatOpen] = useState(false);
  const [favorited, setFavorited] = useState(rec.favorite);
  const [savedToDevice, setSavedToDevice] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0); // 0-100 within the CURRENT item, for the status bar
  // The center play/pause glyph shows briefly then hides for a "clear full screen"
  // (owner). `dragY` follows a downward swipe so the clip dismisses like a story.
  const [controlsVisible, setControlsVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  /*
    ── Press-and-hold = full clear screen (owner, 2026-08-16: "the story and
    history should show full clear screen on press and hold") ────────────────
    Lives on the SAME gesture surface the tap/swipe classification already
    uses (`onPointerDown`/`onPointerMove`/`endGesture` below), not a second
    parallel handler — this surface already has to arbitrate tap vs. swipe,
    and a hold is the third outcome of the same press, not an unrelated one.
  */
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimer = useRef<number | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number } | null>(null);
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
    allowWindowOpen();
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

  /* ── Playback controls — WhatsApp-story gestures (owner spec) ─────────────────
   *  On the full-screen media:
   *    • tap LEFT third   → previous clip
   *    • tap CENTER third → play / pause (video); the play glyph shows ~2s then
   *                         hides so the view is a clear full screen
   *    • tap RIGHT third  → next clip
   *    • swipe DOWN        → exit
   *  A clip also auto-advances when it ends. Keyboard mirrors this (Space / ← / → /
   *  ↓ / Esc). No scrubber, no double-tap seek — deliberately minimal, like a story.
   */
  const SWIPE_CLOSE_PX = 90;

  // Reveal the center glyph, then hide it after 2s so the view goes clear (owner).
  const revealControls = () => {
    if (controlsTimer.current) window.clearTimeout(controlsTimer.current);
    setControlsVisible(true);
    controlsTimer.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsTimer.current = null;
    }, 2000);
  };
  const hideControls = () => {
    if (controlsTimer.current) window.clearTimeout(controlsTimer.current);
    controlsTimer.current = null;
    setControlsVisible(false);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    haptic("light");
    // onPlay / onPause (on the <video>) drive `paused` and the glyph reveal/hide,
    // so this just flips playback and both taps (pause AND resume) get the beat.
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const goPrev = () => {
    if (index === 0) return;
    haptic("light");
    playerPrev();
  };
  const goNext = () => {
    if (index >= total - 1) return; // a tap never dismisses; only a finished clip advances past the end
    haptic("light");
    playerNext();
  };

  /* One gesture surface over the media: a near-stationary press is a TAP (its x
   * position picks previous / play-pause / next); a downward drag is a SWIPE that
   * follows the finger and, past the threshold, exits — exactly like a story. */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    gesture.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setDragY(0);
    // A hold that survives 220ms without turning into a drag (cancelled below)
    // clears the screen. Shorter than that and it reads as an ordinary tap —
    // long enough that no real tap ever crosses it by accident.
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      haptic("light");
      setHolding(true);
      videoRef.current?.pause();
    }, 220);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.y;
    const dx = e.clientX - g.x;
    // Real movement means this press is a drag, not a hold — the hold-timer
    // (if it hasn't already fired) is cancelled so a swipe never also clears
    // the screen on its way to closing.
    if (Math.hypot(dx, dy) > 12 && holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) setDragY(dy); // follow a downward drag only
  };
  const endGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    const wasHolding = holding;
    setHolding(false);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    // Releasing a hold just restores the chrome — it is not ALSO a tap or a
    // swipe, even though the finger lifted from roughly the same spot it
    // pressed down on.
    if (wasHolding) {
      if (rec.kind === "video") void videoRef.current?.play().catch(() => {});
      return;
    }
    const dy = e.clientY - g.y;
    const dx = e.clientX - g.x;
    const dt = Date.now() - g.t;
    if (dy > SWIPE_CLOSE_PX && dy > Math.abs(dx)) {
      // Swipe down → exit.
      haptic("light");
      closePlayer();
      return;
    }
    setDragY(0); // snap back
    if (Math.hypot(dx, dy) < 12 && dt < 500) {
      // A near-stationary quick press is a tap; zone by horizontal position.
      const frac = e.clientX / Math.max(1, window.innerWidth);
      if (frac < 0.34) goPrev();
      else if (frac > 0.66) goNext();
      else if (rec.kind === "video") togglePlay();
    }
  };

  // Clear the glyph timer on unmount so it never fires late.
  useEffect(() => () => { if (controlsTimer.current) window.clearTimeout(controlsTimer.current); }, []);

  // Keyboard mirror: Esc / ↓ close; Space toggles; ← / → previous / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "ArrowDown") return closePlayer();
      if (e.key === " " && rec.kind === "video") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        goNext();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.kind, index, total]);

  // Follows a downward swipe (translate + a slight fade) then snaps back on release.
  const mediaDragStyle: CSSProperties = {
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition: dragY ? "none" : "transform 0.22s ease, opacity 0.22s ease",
    opacity: dragY ? Math.max(0.35, 1 - dragY / 600) : undefined,
  };

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={rec.title}>
      {/* Status — segmented, like Stories/WhatsApp: one bar per queued item, the
          current one fills with real playback progress (a non-video item reads as
          complete). Always shown — a single segment for a lone clip — so even one
          video gets a status-style progress line. Cleared of the safe area
          (Dynamic Island / status bar) via var(--frenz-safe-top).

          🔴 Fades out with the rest of the chrome on a hold (owner, 2026-08-16:
          "the story and history should show full clear screen on press and
          hold") — same treatment as the story viewer's equivalent bar. */}
      <div
        className={cn(
          "absolute inset-x-3 top-[calc(0.5rem+var(--frenz-safe-top))] z-20 flex gap-1 transition-opacity duration-150",
          holding && "opacity-0",
        )}
      >
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
        className={cn(
          "fixed left-4 top-[calc(1.75rem+var(--frenz-safe-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        <X className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="More options"
        className={cn(
          "fixed right-4 top-[calc(1.75rem+var(--frenz-safe-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {/*
        Title / position — TAP TO READ THE WHOLE CAPTION.

        It was `pointer-events-none` + `truncate`, so a long caption was cut off
        here exactly as it is on the grid tile, and the "…more" cue on that tile
        led to another truncation. Now the line is a real control: collapsed it
        reads as before, expanded it shows the caption in full and scrolls if it
        is long.

        It stays inset between the close and menu buttons so it can never
        overlap either, and the expanded panel gets its own scrim — white text
        over arbitrary video frames is otherwise unreadable.
      */}
      <div
        className={cn(
          "absolute inset-x-16 top-[calc(2rem+var(--frenz-safe-top))] z-10 transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          onClick={() => setCaptionOpen((v) => !v)}
          aria-expanded={captionOpen}
          aria-label={captionOpen ? "Hide caption" : "Show full caption"}
          className={cn(
            "block w-full rounded-xl text-center text-sm font-medium text-white/90 transition",
            captionOpen && "max-h-[40vh] overflow-y-auto overscroll-contain bg-black/70 p-3 text-left backdrop-blur-md",
          )}
        >
          <span className={cn(captionOpen ? "whitespace-pre-wrap break-words" : "block truncate")}>
            {rec.title}
            {total > 1 ? <span className="text-white/60"> · {index + 1}/{total}</span> : null}
          </span>
          {/* Only offered when there is genuinely more to see. */}
          {!captionOpen && rec.title.length > 40 ? (
            <span className="mt-0.5 block text-[11px] font-semibold text-white/60">…more</span>
          ) : null}
        </button>
      </div>

      {/* The stage — full-bleed media. object-contain never crops the width or
          over-stretches beyond the source: it letterboxes on black, and the bottom
          extends all the way to the true viewport edge (owner, 2026-08-16: "so it
          reached the bottom 0"). iOS-gallery tap zones sit over the media, under
          the chrome.

          🔴 Top is padded to `--frenz-safe-top` (owner, 2026-08-18: "the image
          doesn't reach the safe area boundary, I want it to reach the safe area
          tip at the top but not cross it... I only see a black top"). Before this,
          the media extended UNDER the status bar/notch same as the bottom, which
          on-device read as a dead black strip with the status-bar segments
          missing from it rather than a clean edge — the status bar's own row
          (below) already computes its `top` off the same variable, so it now sits
          flush against the media's new top edge instead of floating in extra
          space that used to be there for no visible reason. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center pt-[var(--frenz-safe-top)]">
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
          <img src={url} alt={rec.title} className="h-full w-full object-contain" style={mediaDragStyle} />
        ) : url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={url}
            autoPlay
            playsInline
            className="h-full w-full bg-black object-contain"
            style={mediaDragStyle}
            onEnded={() => playerClipEnded()}
            onPlay={() => { setPaused(false); hideControls(); }}
            onPause={() => { setPaused(true); revealControls(); }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        ) : null}

        {/* One WhatsApp-story gesture surface over the media, UNDER the chrome
            (z-10/20) so the X, •••, status bar and Save button stay tappable. A
            near-stationary tap's x position picks previous / play-pause / next; a
            downward swipe follows the finger and, past the threshold, exits.
            touch-action:none keeps the browser from stealing the vertical drag. */}
        {url && !error && rec.kind !== "audio" ? (
          <div
            className="absolute inset-0 z-[5] select-none [touch-action:none]"
            role="group"
            aria-label="Tap left or right for previous or next, tap center to pause, swipe down to close"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={() => {
              if (holdTimer.current) {
                window.clearTimeout(holdTimer.current);
                holdTimer.current = null;
              }
              if (holding && rec.kind === "video") void videoRef.current?.play().catch(() => {});
              setHolding(false);
              gesture.current = null;
              setDragY(0);
            }}
          />
        ) : null}

        {/* Center play glyph — shown ~2s after a pause, then it fades out for a
            clear full screen (owner). */}
        <AnimatePresence>
          {paused && controlsVisible && !holding && rec.kind === "video" && url ? (
            <motion.span
              key="playglyph"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.press}
              className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
                <Play className="ml-0.5 h-7 w-7 fill-white" />
              </span>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Bottom controls: just Save to device — navigation and pausing are the
          story gestures on the media itself, so nothing competes with the content
          for a clean full screen. The strip is pointer-events-none so taps around
          the button still reach the gesture surface; the button is pointer-events-auto. */}
      {url && !error ? (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-opacity duration-150",
            holding && "opacity-0",
          )}
        >
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
