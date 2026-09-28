"use client";

import { AlertCircle, Check, ChevronLeft, Download, ExternalLink, Globe2, Heart, Link2, Loader2, MessageCircle, MoreVertical, Play, Share2, Trash2 } from "lucide-react";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

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
/*
  ── THE SIGNED-IN AVATAR, ONCE PER TAB ────────────────────────────────────
  Owner, 2026-09-27: "avatar should show when is on sign in Download page
  where users have signed in."

  Module-level, not component state: this player remounts on EVERY clip (it
  is keyed by record id), and a per-mount fetch would hit auth and profiles
  again for each swipe through a queue. Resolved once, reused, and left null
  for a signed-out visitor — whose history is local and has no owner to show.
*/
let viewerAvatarCache: { url: string | null } | null = null;

function useViewerAvatar(): string | null {
  const [url, setUrl] = useState<string | null>(viewerAvatarCache?.url ?? null);
  useEffect(() => {
    if (viewerAvatarCache) return;
    let alive = true;
    void (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        const user = data.user;
        if (!user) {
          viewerAvatarCache = { url: null };
          return;
        }
        const meta = (user.user_metadata ?? {}) as { avatar_url?: unknown };
        let found = typeof meta.avatar_url === "string" ? meta.avatar_url : null;
        if (!found) {
          const { data: profile } = await createClient().from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
          const a = (profile as { avatar_url?: unknown } | null)?.avatar_url;
          found = typeof a === "string" && a ? a : null;
        }
        viewerAvatarCache = { url: found };
        if (alive) setUrl(found);
      } catch {
        // a viewer with no avatar is the normal case, not an error worth showing
        viewerAvatarCache = { url: null };
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return url;
}

/** "2 days ago" — when this clip was saved, in the words a history row uses. */
function savedAgo(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

function PlayerInner({ rec, index, total }: { rec: DownloadRecord; index: number; total: number }) {
  /*
    🔴 WHY THE BAR WAS INVISIBLE (owner, twice: "I didn't see the progress bar
    at the top of the history viewer").

    `total` is `queue.items.length`. The segments were rendered with
    `Array.from({ length: total })`, so a queue of ZERO produced zero
    segments — an empty flex row, 0px tall, indistinguishable from a bar that
    was never there. Nothing else on screen depends on `total`, so there was
    no second symptom to notice.

    A lone clip is one segment, which is what the comment below it always
    claimed ("a single segment for a lone clip") and what it now actually
    does. The seek maths uses the same floor so a drag cannot divide by zero.
  */
  /*
    🔴 THE ACTUAL BUG, FOUND ON THE FOURTH LOOK (owner, three reports: "this
    history doesn't have a progress stripe bar like WhatsApp").

    `total` is `queue.items.length`, and `media-gallery.tsx` opens the player
    with the WHOLE sorted history — every download the member has ever kept.
    The stripe rendered one `flex-1` segment per item with a 4px gap between
    them, so on a 406px row a history of sixty clips gave each segment
    (406 - 59x4) / 60 ≈ 2.8px, separated by gaps wider than themselves.

    It WAS rendering. It was a row of near-invisible dashes, which is why every
    previous fix — the zero-length guard, the hit area, the contrast — was a
    real repair that changed nothing anyone could see.

    WhatsApp has the same constraint and solves it by not drawing more segments
    than can be read. Above the cap this becomes ONE bar for the clip being
    watched; the header already carries "n/N" for position in the queue, so
    nothing is lost but the dashes.
  */
  const MAX_SEGMENTS = 12;
  const segmented = total > 1 && total <= MAX_SEGMENTS;
  const segments = segmented ? total : 1;
  /* With one bar, it tracks the CURRENT clip, so index no longer offsets it. */
  const filledBefore = segmented ? index : 0;
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
  const viewerAvatar = useViewerAvatar();
  /*
    ── DRAG THE BAR TO SEEK (owner, 2026-09-27) ──────────────────────────────
    "make users can fast forward or backward video by dragging the progress
    bar."

    🔴 THE BAR HAS ITS OWN GESTURE, SEPARATE FROM THE MEDIA'S. The surface
    below already arbitrates tap-vs-swipe-vs-hold for previous/next/pause, and
    a drag that means "seek" must never be read as one of those. So the bar
    sits ABOVE it (z-30), captures the pointer, and is `touch-none` while a
    video is loaded — the browser's own scroll/refresh gesture would otherwise
    steal a horizontal drag that starts near the top of the screen.

    The hit area is padded (`py-3 -my-3`) without moving the 1px line: a bar
    that is literally one pixel tall is a bar nobody can grab on a phone.

    While scrubbing the fill drops its width transition — otherwise the bar
    eases toward each new position and lags the finger by a frame.
  */
  const barRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const wasPlaying = useRef(false);

  /** Seek to wherever x falls across the CURRENT item's segment. */
  const seekToClientX = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      const video = videoRef.current;
      if (!bar || !video) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;
      /*
        The bar shows one segment per queued item, so the CURRENT clip owns
        only its own slice of the width. Seeking has to map x within that
        slice, not across the whole bar, or a two-item queue would scrub at
        double speed.
      */
      const gap = 4; // the flex gap, in px, matching `gap-1`
      const segment = (rect.width - gap * (segments - 1)) / segments;
      const left = rect.left + filledBefore * (segment + gap);
      const fraction = Math.min(1, Math.max(0, (clientX - left) / segment));
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (duration <= 0) return;
      video.currentTime = fraction * duration;
      setProgress(fraction * 100);
    },
    [filledBefore, segments],
  );

  const onScrubDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (rec.kind !== "video" || !url) return;
    const video = videoRef.current;
    if (!video) return;
    e.stopPropagation(); // never let the media surface read this as a tap
    e.currentTarget.setPointerCapture?.(e.pointerId);
    wasPlaying.current = !video.paused;
    video.pause();
    setScrubbing(true);
    bumpSave();
    seekToClientX(e.clientX);
  };
  const onScrubMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    e.stopPropagation();
    seekToClientX(e.clientX);
  };
  const endScrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    e.stopPropagation();
    setScrubbing(false);
    // resume only if it was playing when the drag began — a paused clip stays paused
    if (wasPlaying.current) void videoRef.current?.play().catch(() => {});
  };
  /*
    ── SAVE TO DEVICE GETS OUT OF THE WAY (owner, 2026-09-27) ───────────────
    "Make the save to device button to hide after 4 secs of no screen touch
    interaction and it should show when a new video start and hide after 4
    secs of no screen touch interaction."

    The rest of this player already treats the media as the content and the
    chrome as temporary — the play glyph shows briefly, a hold clears the
    screen entirely. The one thing that never left was the white pill at the
    bottom, sitting over every clip for its whole length.

    🔴 It hides by OPACITY and keeps `pointer-events-none` while hidden, not
    by unmounting: a button that unmounts mid-fade eats the tap that was
    already travelling toward it, and re-mounting it on the next touch would
    animate from nothing every time. Hidden it is invisible and untappable;
    the next touch anywhere brings it straight back.
  */
  const [saveVisible, setSaveVisible] = useState(true);
  const saveTimer = useRef<number | null>(null);
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

  /** Show the Save pill and restart its four seconds. Every touch calls this. */
  const bumpSave = useCallback(() => {
    setSaveVisible(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      setSaveVisible(false);
    }, 4000);
  }, []);

  /*
    A NEW CLIP STARTS THE CLOCK AGAIN — the owner asked for it explicitly, and
    it is also the only way the button is discoverable: advancing through a
    queue is not a touch, so without this the pill would stay hidden for every
    clip after the first.
  */
  useEffect(() => {
    bumpSave();
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [rec.id, bumpSave]);

  /* One gesture surface over the media: a near-stationary press is a TAP (its x
   * position picks previous / play-pause / next); a downward drag is a SWIPE that
   * follows the finger and, past the threshold, exits — exactly like a story. */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // any touch on the media brings the pill back and restarts its four seconds
    bumpSave();
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

  /*
    ═══════════════════════════════════════════════════════════════════════
     THE PLAYER LIVES IN THE BROWSER'S TOP LAYER, NOT AT A HIGH z-index
    ═══════════════════════════════════════════════════════════════════════

    Owner, 2026-09-03, twice: "the in page push still shows on the video
    player" / "the monetag in page push still shows on the media".

    z-index could not win this. Raising the player to 2147483646 was not
    enough, which means the widget is at the 2147483647 ceiling — and even
    MATCHING it loses, because ties break on DOM order and a self-placing ad
    appends itself to <body> long after our React tree. There is no number
    above the maximum.

    A modal <dialog> is rendered in the TOP LAYER, which sits above every
    stacking context in the document regardless of z-index or document order.
    It is the only mechanism that reliably wins, and it is the standard one.

    🟢 CONFIRMED WORKING by the owner, 2026-09-07: "the history Media player
    doesn't show the in page push on the media anymore." Do not refactor this
    into something tidier without a reason better than tidiness.

    🔴 It COVERS the ad, it does not hide it. The creative stays exactly as
    Monetag rendered it, still on the page, still counted — a fullscreen viewer
    occluding the page beneath it is ordinary publisher layout, and the same
    thing that happens to every other ad on the page. Removing or hiding a
    served creative would suppress an impression the network had already
    billed, which is the line this codebase does not cross.

    The fallback matters: if `showModal` is unavailable, a <dialog> with no
    `open` attribute is `display: none` — the player would vanish entirely.
    So a failure sets `open` directly, which renders it in the normal flow at
    the z-index below. Worse layering, never an invisible player.
  */
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    try {
      if (!el.open) el.showModal();
    } catch {
      el.open = true;
    }
    return () => {
      try {
        if (el.open) el.close();
      } catch {
        /* already detached */
      }
    };
  }, []);

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

  /*
    ── THE WHOLE VIEWER FOLLOWS THE DRAG, NOT JUST THE MEDIA ─────────────────
    Owner, 2026-09-27: "drag down to exit, it's supposed to pull down the whole
    media viewer page not just the media card."

    This style was applied to the `<img>` / `<video>` alone, so a downward drag
    slid the picture out of a viewer whose header, progress bar and black
    backdrop stayed nailed in place — the clip appeared to fall out of a frame
    rather than the sheet being pulled away. Every native story viewer moves the
    whole surface, which is what makes the gesture read as "dismiss" instead of
    "move the photo".

    It is applied to the dialog now. Two consequences worth knowing:
      • A transform makes the dialog the containing block for any `fixed`
        descendant. Every piece of chrome here is `absolute` within it already,
        so they travel with it — which is the point.
      • The backdrop is deliberately NOT faded with it. The page behind must not
        start showing through until the drag is actually released as a dismiss,
        or an abandoned drag flashes the list underneath.
  */
  const viewerDragStyle: CSSProperties = {
    transform: dragY ? `translateY(${dragY}px)` : undefined,
    transition: dragY ? "none" : "transform 0.22s ease, opacity 0.22s ease",
    opacity: dragY ? Math.max(0.35, 1 - dragY / 600) : undefined,
  };

  return (
    /*
      🔴 z-index 2147483646, not 92 (owner, 2026-09-03: "the in page push should
      not show when a user is watching a media un history").

      Monetag's In-Page Push draws itself at the top of the viewport on a
      z-index far above anything this app uses — its own container measures
      9999, and self-placing widgets commonly go to the 2147483647 ceiling. At
      92 this player rendered UNDERNEATH it, so the ad sat over the video.

      COVERING is the fix, not hiding. A fullscreen viewer legitimately occludes
      the page beneath it, exactly as it does every other ad and every piece of
      chrome; nothing is removed, nothing is restyled, and the creative the
      network served stays served and counted. Actively hiding it would suppress
      an impression the network had already billed — the line this codebase does
      not cross, and the reason three ad changes were backed out this week.

      One below the maximum on purpose: it leaves a single step for anything
      that genuinely must sit on top of a fullscreen player (an OS-level prompt,
      a future critical alert) without another z-index war.
    */
    <dialog
      ref={dialogRef}
      /*
        Escape is handled by this component's own keydown listener, which also
        owns ArrowDown/Space/Arrows. Letting the dialog close ITSELF would tear
        the element down without `closePlayer()` running, leaving the queue
        state saying a player is open when none is.
      */
      onCancel={(e) => {
        e.preventDefault();
        closePlayer();
      }}
      /*
        The UA gives a modal dialog a centred box with its own width, margin,
        padding and border. All four are reset so this fills the viewport
        exactly as the div it replaced did. The z-index is kept only for the
        `showModal` fallback path above — in the top layer it is ignored.
      */
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-black/95 p-0 backdrop:bg-black/95"
      style={{ zIndex: 2147483646, ...viewerDragStyle }}
      aria-label={rec.title}
    >
      {/*
        ── THE TOP CHROME STACK ─────────────────────────────────────────────
        One positioned container holding the stripe and then the header, both
        in ordinary flow. It owns the safe-area inset for the pair, so the
        Dynamic Island is cleared exactly once and neither child computes a
        `top` of its own.

        `pointer-events-none` on the stack with `pointer-events-auto` on the
        children: the gap between the two rows must not eat a tap meant for
        the video underneath.
      */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[calc(0.55rem+var(--frenz-safe-top))]"
      >
      <div className="pointer-events-auto">
      {/* Status — segmented, like Stories/WhatsApp: one bar per queued item, the
          current one fills with real playback progress (a non-video item reads as
          complete). Always shown — a single segment for a lone clip — so even one
          video gets a status-style progress line. Cleared of the safe area
          (Dynamic Island / status bar) via var(--frenz-safe-top).

          🔴 Fades out with the rest of the chrome on a hold (owner, 2026-08-16:
          "the story and history should show full clear screen on press and
          hold") — same treatment as the story viewer's equivalent bar. */}
      <div
        ref={barRef}
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        className={cn(
          /*
            🔴 IN NORMAL FLOW, NOT ABSOLUTELY POSITIONED (owner, third report:
            "this history doesn't have a progress stripe bar like WhatsApp and
            yet you keep ignoring it").

            Three attempts at this failed while it was `absolute` with a `top`
            of `calc(0.55rem + var(--frenz-safe-top))`, each fixing a real but
            different defect — a zero-length segment array, a hit area that
            swallowed the header's taps, too little contrast — and the stripe
            still did not appear on the device.

            So the positioning goes. The stripe is now the FIRST CHILD of the
            top chrome stack, in ordinary flow, and the stack carries the safe
            area. There is no `top` to compute, no containing block to resolve
            against, no z-order against the header, and no way for the safe
            inset to be counted twice or not at all. WhatsApp puts it in its
            own row above the header; so does this now.
          */
          "flex gap-1 transition-opacity duration-150",
          /*
            A 3px line is not grabbable, so the row is padded to ~19px and the
            padding is pulled back visually. It can be generous now: the header
            is a SIBLING BELOW rather than a layer underneath, so this cannot
            swallow a tap meant for Back or the menu the way it once did.
          */
          rec.kind === "video" && url ? "cursor-pointer touch-none py-2" : "",
          holding && "opacity-0",
        )}
      >
        {Array.from({ length: segments }).map((_, i) => (
          // the track carries its own shadow so the line reads on a bright frame as well as on the black bands
          <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/45 shadow-[0_0_3px_rgb(0_0_0/0.6)]">
            <span
              className={cn("block h-full rounded-full bg-white", scrubbing ? "" : "transition-[width] duration-150")}
              style={{
                width: `${i < filledBefore ? 100 : i === filledBefore ? (rec.kind === "video" ? progress : 100) : 0}%`,
              }}
            />
          </span>
        ))}
      </div>
      </div>

      <div className="pointer-events-auto mt-1">
      {/*
        ── THE HEADER (owner, 2026-09-27) ───────────────────────────────────
        "The title should be at the top below the progress bar and the avatar
        and type and date downloaded." Story-viewer chrome: back, who saved
        it, what it is and when — on ONE line under the segments, instead of
        two buttons floating in opposite corners with the title at the foot
        of the screen.

        No reply or reaction row: this is the member's OWN history, and there
        is nobody to reply to.
      */}
      <div
        className={cn(
          // A sibling under the stripe, in flow. No `top`, no z-index: the
          // stack above owns the position and the safe area for both.
          "flex items-center gap-2.5 transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        <button type="button" onClick={closePlayer} aria-label="Close" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white">
          <ChevronLeft className="h-6 w-6" />
        </button>
        {viewerAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed URL from the member's own profile, not a known-size asset
          <img src={viewerAvatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/30" />
        ) : null}
        <button
          type="button"
          onClick={() => setCaptionOpen((v) => !v)}
          aria-expanded={captionOpen}
          aria-label={captionOpen ? "Hide caption" : "Show full caption"}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[14px] font-semibold leading-tight text-white">{rec.title}</span>
          <span className="block truncate text-[11.5px] leading-tight text-white/70">
            {rec.kind === "video" ? "Video" : rec.kind === "audio" ? "Audio" : "Image"}
            {rec.platformName ? ` · ${rec.platformName}` : ""} · {savedAgo(rec.createdAt)}
          </span>
        </button>
        <button type="button" onClick={() => setMoreOpen(true)} aria-label="More options" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white">
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>
      </div>
      </div>
      {/*
        THE FULL CAPTION, WHEN ASKED FOR (2026-09-27).

        The collapsed title used to live here, floating over the middle of the
        screen between the two corner buttons. It is now the header's own
        first line, so this is only what the header cannot hold: the whole
        caption, opened by tapping that line, scrolling when it is long, with
        its own scrim because white text over an arbitrary video frame is
        unreadable.
      */}
      {captionOpen ? (
        <button
          type="button"
          onClick={() => setCaptionOpen(false)}
          aria-label="Hide caption"
          className={cn(
            "absolute inset-x-3 top-[calc(5.1rem+var(--frenz-safe-top))] z-20 max-h-[40vh] overflow-y-auto overscroll-contain rounded-2xl bg-black/70 p-3 text-left backdrop-blur-md transition-opacity duration-150",
            holding && "pointer-events-none opacity-0",
          )}
        >
          <span className="block whitespace-pre-wrap break-words text-sm font-medium text-white/90">
            {rec.title}
            {total > 1 ? <span className="text-white/60"> · {index + 1}/{total}</span> : null}
          </span>
        </button>
      ) : null}
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
          <img src={url} alt={rec.title} className="h-full w-full object-contain" />
        ) : url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={url}
            autoPlay
            playsInline
            className="h-full w-full bg-black object-contain"
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
            "pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] transition-opacity duration-300",
            (holding || !saveVisible) && "opacity-0",
          )}
        >
          <button
            type="button"
            onClick={saveToDeviceNow}
            // hidden means untappable: a 0-opacity button still takes the tap that was meant for the media
            tabIndex={saveVisible ? 0 : -1}
            aria-hidden={!saveVisible}
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-elevated transition active:scale-95",
              saveVisible ? "pointer-events-auto" : "pointer-events-none",
            )}
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
    </dialog>
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
