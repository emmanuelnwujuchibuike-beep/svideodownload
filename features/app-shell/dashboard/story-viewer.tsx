"use client";

/*
  The full-screen Story viewer (moved out of stories-row.tsx in Stories Part 2, 2026-10-26). It is loaded only when a
  story is opened: stories-row.tsx exports a `next/dynamic` wrapper under the same name, so the rings on /home,
  /messages, Friends and a chat thread never carry framer-motion, the ad card or these sheets. Drawn to the Story
  Viewer design since 2026-10-26 (design/Frenz-Story-Viewer-design.zip).
*/
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { FastForward, Loader2, Rewind, Send } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSelfAdPool } from "@/features/ads-platform/serve/use-self-ad-pool";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { getEntry, mutate } from "@/features/data";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { faceGradient, useStoryViewers, viewersLine } from "@/features/social/story-viewers-data";
import { TapPending } from "@/features/wallet/tap-pending";
import { toast } from "@/features/ui/toast";
import { fireWowFeedback, WowBurst } from "@/features/ui/wow-burst";

// Sheets a story viewer opens on a tap: loaded then, not with /home (2026-10-16, /home weight).
const ReshareSheet = dynamic(() => import("@/features/social/reshare-sheet").then((m) => m.ReshareSheet), { ssr: false });
const StoryViewersSheet = dynamic(() => import("@/features/social/story-viewers-sheet").then((m) => m.StoryViewersSheet), {
  ssr: false,
});
const SendToChatSheet = dynamic(() => import("@/features/downloads/send-to-chat-sheet").then((m) => m.SendToChatSheet), { ssr: false });
import { haptic } from "@/lib/motion/haptics";
import { isSingleEmoji } from "@/lib/social/single-emoji";
import { readCachedStories, writeCachedStories } from "@/lib/social/story-cache";
import { isStoryLive, nextPosition, positionAfterRemoval, startIndex, withoutStories, type IsSeen, type Position } from "@/lib/social/story-progression";
import type { StoryGroup, StoryItem } from "@/lib/social/stories";
import { isStorySeen, recordStoryView, useSeenOverlay } from "@/lib/social/story-seen";
import { cn } from "@/lib/utils";

/** Every story surface's copy of the rings (Home/Messages, the Friends tabs) and the disk copy, without these stories. */
function forgetStories(ids: ReadonlySet<string>) {
  for (const key of ["stories", "stories:friends", "stories:following"]) {
    if (getEntry<StoryGroup[]>(key).data === undefined) continue;
    mutate<StoryGroup[]>(key, (prev) => withoutStories(prev ?? [], ids));
  }
  const disk = readCachedStories();
  if (disk) writeCachedStories(withoutStories(disk, ids));
}

const IMAGE_MS = 5000;

// Ad Platform Part 5: a paid card between two people's Stories — fetched only when one shows.
// The ••• sheet (send to chat, save, seen by, delete / report) — fetched on the first tap.
const StoryOptions = dynamic(() => import("@/features/social/story-options").then((m) => m.StoryOptions), { ssr: false });
// Stories Part 5: "Add to highlight", loaded on the first tap of Highlight
const HighlightPicker = dynamic(() => import("@/features/social/highlight-picker").then((m) => m.HighlightPicker), { ssr: false });

const SelfStoryCard = dynamic(() => import("@/features/ads-platform/serve/self-story-card").then((m) => m.SelfStoryCard), { ssr: false });

export function StoryViewer({
  groups: incomingGroups,
  startGroup,
  startStoryId,
  onClose,
}: {
  groups: StoryGroup[];
  startGroup: number;
  /** open at this exact story (a "Frenz Coin for your story" notification) instead of the ring's first unwatched one */
  startStoryId?: string;
  onClose: () => void;
}) {
  /*
    Watched or not, per story (Stories Part 3): the server's `seen` plus the views
    this session has had confirmed. Read through a ref by the navigation below, so
    a view landing mid-story does not rebuild `next` and restart the image timer.
  */
  const overlay = useSeenOverlay();
  const isSeen = useCallback<IsSeen>((s: StoryItem) => isStorySeen(s, overlay), [overlay]);
  const isSeenRef = useRef(isSeen);
  isSeenRef.current = isSeen;

  /*
    Stories that left while the viewer is open: deleted by their author here
    (owner, 2026-10-08), ended, or no longer this viewer's to see (Stories Part 3 —
    the view request says so). Filtered locally so the viewer moves on at once
    whichever surface opened it (the home row, Friends, a chat), and every
    surface's copy of the rings drops them too (`forgetStories`). Stories already
    over when the viewer opens never show at all.
  */
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => {
    const now = Date.now();
    return new Set(incomingGroups.flatMap((g) => g.stories).filter((s) => !isStoryLive(s, now)).map((s) => s.id));
  });
  const groups = useMemo(() => withoutStories(incomingGroups, goneIds), [incomingGroups, goneIds]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsUsed, setOptionsUsed] = useState(false);
  useEffect(() => {
    if (optionsOpen) setOptionsUsed(true);
  }, [optionsOpen]);
  // the ring that was tapped (found by author — an ended story may have shifted the list), at its first unwatched story
  const [gi, setGi] = useState(() => Math.max(0, groups.findIndex((g) => g.userId === incomingGroups[startGroup]?.userId)));
  /*
    Ad Platform Part 5 (placement stories_card): BETWEEN two people's stories,
    never inside one, at most once per the format's admin gap. The story under
    it is paused until it is done; with no live campaign this is an empty pool
    and nothing changes.
  */
  const storyAds = useSelfAdPool("stories_card", "stories");
  const [paidCard, setPaidCard] = useState<EligibleAd | null>(null);
  const [si, setSi] = useState(() => {
    const exact = startStoryId ? (groups[gi]?.stories.findIndex((s) => s.id === startStoryId) ?? -1) : -1;
    return exact >= 0 ? exact : startIndex(groups[gi], isSeen);
  });
  const [pct, setPct] = useState(0);
  /*
    ── 🔴 THE SHAPE OF THE SOURCE DECIDES, NOT THE VIEWER (owner, 2026-10-04) ─

    "History and story viewer still show the bottom and top black chrome
    instead of the media covering all except the safe area."

    `object-contain` letterboxes, so a 9:16 clip on a 9:19.5 phone sat in a
    black sandwich. `object-cover` everywhere would be worse — a landscape
    video filling a portrait screen loses most of the frame. So:

      portrait  (h > w)  → cover   (~18% of width cropped on a 9:16 clip,
                                    which is exactly what every short-form
                                    app does)
      square / landscape → contain (cropping these destroys the content)

    Measured from the file on `loadedmetadata` / `load`, never guessed from
    the platform. 🔴 The SAME rule and the same reading of it govern
    `features/downloads/download-player.tsx`, which is the point — the two
    viewers must not drift into two answers to one question.
  */
  const [fillFrame, setFillFrame] = useState(false);
  const [replying, setReplying] = useState(false);
  const [resharing, setResharing] = useState(false);
  /* The author’s own “Seen by” sheet. Lazy: nothing is fetched until it opens. */
  const [viewersOpen, setViewersOpen] = useState(false);
  /*
    ── Press-and-hold = full clear screen (owner, 2026-08-16: "the story and
    history should show full clear screen on press and hold") ────────────────
    Reuses the exact pause mechanism `replying` already drives — video.pause()
    and the image auto-advance RAF both already gate on that flag below, so
    holding just needed to join the same gate rather than a second, parallel
    pause path. A tap on the same left/right zones still navigates: the hold
    threshold (220ms) is short enough to feel immediate but long enough that
    an ordinary tap never crosses it, and `wasHold` suppresses the click that
    would otherwise fire once the pointer lifts off a genuine hold.
  */
  /*
    2026-10-15 (owner): "make press and hold on right to fast forward on 2x, and left to be
    backward on 2x". The hold still clears the screen; it now also plays the story at 2x —
    forward on the right two thirds, backward on the left third — with a 2x badge. A video
    plays at playbackRate 2 or steps back 0.2 s every 100 ms; an image's timer runs at ±2x.
  */
  const [holding, setHolding] = useState<false | "back" | "forward">(false);
  const holdRef = useRef<false | "back" | "forward">(false);
  holdRef.current = holding;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHold = useRef(false);
  const startHold = useCallback((dir: "back" | "forward") => {
    wasHold.current = false;
    holdTimer.current = setTimeout(() => {
      wasHold.current = true;
      haptic("light");
      setHolding(dir);
    }, 220);
  }, []);
  const endHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);

  /*
    Each slide is a new shape. Without this, the previous story's verdict
    survives until the next load event, so stepping from a portrait clip to a
    landscape one crops it for a frame — a flash that reads as a bug.
  */
  useEffect(() => {
    setFillFrame(false);
  }, [gi, si]);
  // `frenzCoin` is the on/off flag /api/me already carries — the gift button needs no wallet request
  const { handle, frenzCoin, ready: entitlementsReady } = useEntitlements();

  const group = groups[gi]!;
  const story = group?.stories[si];
  const isOwn = !!handle && group?.handle === handle;

  // The author's own switch (owner, 2026-07-16: "users who made the posts on
  // stories … can set the media to be reshare or not"). Optimistic, and the
  // server enforces the real rule regardless of what this shows.
  const [allowReshare, setAllowReshare] = useState<boolean | null>(null);
  const effectiveAllow = allowReshare ?? story?.allowReshare ?? true;
  useEffect(() => setAllowReshare(null), [story?.id]);

  const toggleAllowReshare = async () => {
    if (!story) return;
    const next = !effectiveAllow;
    setAllowReshare(next);
    haptic("selection");
    try {
      const res = await fetch("/api/reshare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "story", sourceId: story.id, allowReshare: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? "Others can reshare this story" : "Resharing turned off for this story", "success");
    } catch {
      setAllowReshare(!next); // roll back
      toast("Couldn't save that.", "error");
    }
  };

  /*
    The author's "Allow replies" (Story options, 0288). Optimistic like resharing;
    the reply route obeys the stored value whatever this shows.
  */
  const [allowRepliesOverride, setAllowRepliesOverride] = useState<boolean | null>(null);
  const allowReplies = allowRepliesOverride ?? story?.allowReplies ?? true;
  useEffect(() => setAllowRepliesOverride(null), [story?.id]);
  const toggleAllowReplies = async () => {
    if (!story) return;
    const next = !allowReplies;
    setAllowRepliesOverride(next);
    haptic("selection");
    try {
      const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowReplies: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? "Replies are on for this story" : "Replies are off for this story", "success");
    } catch {
      setAllowRepliesOverride(!next);
      toast("Couldn't save that.", "error");
    }
  };

  // the sound control on a video story (the design's speaker button) — kept across stories while the viewer is open
  const [muted, setMuted] = useState(false);
  // your own story's "Share": the existing send-to-chat sheet, fetched on the tap
  const [sendOpen, setSendOpen] = useState(false);
  // your own story: the "Add to highlight" sheet
  const [highlighting, setHighlighting] = useState(false);
  // the people who saw YOUR story, for the bottom bar (one read per story, only for your own)
  const ownViewers = useStoryViewers(isOwn && story ? story.id : null);

  /*
    🔴 Stories Part 3: opening a ring no longer marks it seen. It used to write a
    device-local mark for the author's NEWEST story the moment the ring opened,
    which greyed every story in it — including the ones never shown. A story is
    now seen only when its own view is recorded, below.
  */

  /*
    A story leaves (Part 3): the viewer stands where `positionAfterRemoval` says,
    or closes when nothing is left. The refs move with each call, so two stories
    leaving before React re-renders still land on the right one.
  */
  const posRef = useRef<Position>({ gi, si });
  posRef.current = { gi, si };
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const dropStories = useCallback(
    (ids: readonly string[]) => {
      const removed = new Set(ids);
      const before = groupsRef.current;
      const at = posRef.current;
      const onScreen = before[at.gi]?.stories[at.si]?.id;
      const to = positionAfterRemoval(before, at, removed, isSeenRef.current);
      groupsRef.current = withoutStories(before, removed);
      setGoneIds((prev) => new Set([...prev, ...removed]));
      forgetStories(removed);
      if (!to) {
        onClose();
        return;
      }
      posRef.current = to;
      if (onScreen && removed.has(onScreen)) setPct(0);
      setGi(to.gi);
      setSi(to.si);
    },
    [onClose],
  );

  // A story that ends while the viewer is open is passed over, not played on.
  useEffect(() => {
    if (story && !isStoryLive(story, Date.now())) dropStories([story.id]);
  }, [story, dropStories]);

  // Nothing left to show (every story ended, or the ring tapped was already gone): close, never a blank takeover.
  useEffect(() => {
    if (!story) onClose();
  }, [story, onClose]);

  /*
    ── 🔴 PRELOAD THE NEXT ONE (owner, 2026-10-04: "stories delays to load
       when moving to the next story") ──────────────────────────────────────

    There was no preloading of any kind: a story's media began downloading only
    once it BECAME the current one, so every tap paid a full fetch before
    anything painted. On a phone that is the pause being described.

    What is preloaded is deliberately narrow — exactly one item ahead, and only
    while somebody is actively watching:

      · an image story → the image itself, which is the whole payload and the
        common case;
      · a video story  → its stored poster (0083), NOT the MP4. The poster is
        tens of kilobytes and makes the next frame paint instantly while the
        video buffers behind it; speculatively pulling megabytes of H.264 the
        member may never reach is the kind of consumption this project has a
        standing rule against.

    One ahead, not the whole group, for the same reason. This is demand-driven
    — it only runs because a story is open and being watched — so it costs
    nothing when nobody is looking, which is the test that rule actually sets.
  */
  useEffect(() => {
    if (!group) return;
    // the story `next()` will actually go to — the next ring opens at its first unwatched one
    const to = nextPosition(groups, { gi, si }, isSeenRef.current);
    const next = to ? groups[to.gi]?.stories[to.si] : undefined;
    if (!next) return;
    const href = next.mediaKind === "image" ? next.mediaUrl : next.thumbnailUrl;
    if (!href) return;
    // `window.Image`, not `Image` — `next/image` is imported as `Image` in this
    // file and shadows the DOM constructor.
    const img = new window.Image();
    img.decoding = "async";
    img.src = href;
  }, [group, groups, gi, si]);

  /*
    ── Record the view, per STORY (2026-10-04, migration 0181) ───────────────

    Keyed on the individual story, not the group: the author's question is "who
    saw THIS one", and a group-level record would credit a viewer with having
    seen seven statuses when they swiped away after the first.

    Fire-and-forget, and `keepalive` so a record survives the viewer being
    closed in the same gesture that triggered it. Your own story is skipped on
    the server too; skipping it here as well saves a pointless request on the
    surface people open most.

    Stories Part 3: keyed on the story's ID, so a re-render, a refetched ring or
    a confirmed view landing never sends it again (story-seen.ts also shares one
    request per story per session). The ring greys only when the server answers
    `recorded`; `available: false` (ended, gone, or no longer the viewer's to
    see — a new block, a privacy change) takes the story off screen at once.
  */
  const storyId = story?.id;
  useEffect(() => {
    if (!storyId || isOwn) return;
    // dropped even if the viewer has moved on by the time the answer lands — it must not be reachable by going back
    void recordStoryView(storyId).then((out) => {
      if (!out.available) dropStories([storyId]);
    });
  }, [storyId, isOwn, dropStories]);

  const next = useCallback(() => {
    setPct(0);
    const to = nextPosition(groups, { gi, si }, isSeenRef.current);
    if (!to) {
      onClose();
      return;
    }
    if (to.changedGroup) {
      // the next paid card that may show now (never the last one, within the admin gap)
      const ad = storyAds.status === "ready" ? storyAds.take() : null;
      if (ad) setPaidCard(ad);
    }
    setGi(to.gi);
    setSi(to.si);
  }, [si, gi, groups, onClose, storyAds]);

  const prev = useCallback(() => {
    setPct(0);
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      const pg = groups[gi - 1]!;
      setGi(gi - 1);
      setSi(Math.max(0, pg.stories.length - 1));
    } else setSi(0);
  }, [si, gi, groups]);

  // The image timer's own elapsed time, kept across a hold/reply pause so
  // resuming continues the segment instead of restarting it — a ref because
  // the pause/resume effect below must not reset it (only navigation should).
  const elapsedRef = useRef(0);
  useEffect(() => {
    elapsedRef.current = 0;
  }, [gi, si]);

  // Auto-advance: images on a timer, videos when they end (progress via timeupdate).
  // Paused (not reset) while the viewer is composing a reply, or held for a
  // clear look — `startedAt` is backdated by whatever had already elapsed, so
  // un-pausing resumes the same segment rather than restarting its 5s.
  useEffect(() => {
    if (!story || story.mediaKind === "video" || replying || paidCard || optionsOpen) return;
    let last = performance.now();
    let raf = 0;
    // Part 9 (2026-10-09): the whole viewer re-rendered every frame (60 Hz) for the
    // bar alone. It now re-renders only when the bar moves by 2 % (about 10 Hz);
    // a short linear CSS transition on the bar keeps it smooth.
    let shown = -1;
    const tick = (now: number) => {
      // 2x forward or backward while held (never below the start of the segment)
      const rate = holdRef.current === "forward" ? 2 : holdRef.current === "back" ? -2 : 1;
      elapsedRef.current = Math.max(0, elapsedRef.current + (now - last) * rate);
      last = now;
      const p = Math.min(100, (elapsedRef.current / IMAGE_MS) * 100);
      const step = p >= 100 ? 100 : Math.floor(p / 2) * 2;
      if (step !== shown) {
        shown = step;
        setPct(step);
      }
      if (p >= 100) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gi, si, story, next, replying, paidCard, optionsOpen]);

  // Pause the story video while replying, or held for a clear look.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (replying || paidCard || optionsOpen) v.pause();
    else void v.play().catch(() => {});
  }, [replying, paidCard, optionsOpen, gi, si]);

  /*
    ── 🔴 NO SOUND WITHOUT THE STORY (owner, 2026-10-27: "story keeps playing the sound even
       without the video playing, and when I go out of the story the sound still continues") ──
    · A <video> taken out of the page can keep sounding (iOS keeps a detached element playing, and a
      play() that resolves after the close starts it again). The element left behind — on the next
      story and when the viewer closes — is paused AND emptied, so nothing can sound from it again.
      Only once it is really out of the page: StrictMode's dev re-run finds it still connected.
    · The app going to the background pauses it; coming back resumes it unless something holds it.
    · A video whose picture never arrives (a codec this phone can't draw — older HEVC stories) played
      its sound over the still poster. After 1.5 s of playback with no decoded frame it is stopped,
      the story says so, and the viewer moves on (onTimeUpdate below).
  */
  const heldRef = useRef(false);
  heldRef.current = !!(replying || paidCard || optionsOpen);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    return () => {
      if (v.isConnected) return;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [gi, si]);
  useEffect(() => {
    const onVis = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.visibilityState === "hidden") v.pause();
      else if (!heldRef.current && !v.ended) void v.play().catch(() => {});
    };
    const onHide = () => videoRef.current?.pause();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  const [noPicture, setNoPicture] = useState(false);
  useEffect(() => setNoPicture(false), [gi, si]);
  useEffect(() => {
    if (!noPicture) return;
    const t = window.setTimeout(next, 2500);
    return () => window.clearTimeout(t);
  }, [noPicture, next]);

  // 2x while held: forward plays at playbackRate 2, backward steps back 0.2 s every 100 ms
  // (no browser plays a video in reverse), then playback resumes where the rewind stopped.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !holding) return;
    if (holding === "forward") {
      v.playbackRate = 2;
      return () => {
        v.playbackRate = 1;
      };
    }
    v.pause();
    const id = window.setInterval(() => {
      v.currentTime = Math.max(0, v.currentTime - 0.2);
      if (v.duration) setPct((v.currentTime / v.duration) * 100);
    }, 100);
    return () => {
      window.clearInterval(id);
      void v.play().catch(() => {});
    };
  }, [holding, gi, si]);

  /*
    Double-tap = Wow (owner, 2026-10-15: "double on the story to wow on it"): the app's one
    Wow burst, haptic and sound, and the author gets a 😮 story reply — once per story, never
    on your own. A single tap now waits 260 ms to know it was not the first of two.
  */
  const rootRef = useRef<HTMLDivElement>(null);
  const [wowKey, setWowKey] = useState(0);
  const wowed = useRef(new Set<string>());
  const tapTimer = useRef<number | null>(null);
  const lastTap = useRef(0);
  useEffect(
    () => () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    },
    [],
  );
  const zoneTap = (go: () => void) => {
    if (wasHold.current) return;
    const now = Date.now();
    if (tapTimer.current !== null && now - lastTap.current < 300) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      fireWowFeedback();
      setWowKey((k) => k + 1);
      if (story && !isOwn && !wowed.current.has(story.id)) {
        wowed.current.add(story.id);
        if (allowReplies) void postStoryReply(group.userId, "😮", { storyId: story.id, reaction: true });
      }
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      go();
    }, 260);
  };

  // A single-emoji reply rises up the screen and fades (owner, 2026-10-15)
  const [rise, setRise] = useState<{ id: number; emoji: string } | null>(null);

  // Escape + scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
    };
  }, [next, prev, onClose]);

  /*
    ── Drag down to close (owner, 2026-08-11) ────────────────────────────────
    Same distance/velocity numbers and drag recipe as `media-action-sheet.tsx`
    — one shared "feel" for every drag-to-dismiss gesture in the app, not a
    second slightly-different one invented here.

    The WHOLE viewer (progress bar, header, media, reply bar) is one draggable
    unit: it is a full-screen takeover with nothing else to leave in place, so
    unlike a sheet there is no content underneath it to hold still. Locked
    upward (`dragElastic.top: 0`) so it can't be dragged off the top; elastic
    downward so a real finger gets resistance, not a 1:1 free-fall.

    A tap on the prev/next zones, the close button, or the reply composer all
    still work normally — framer distinguishes a drag from a tap by movement
    distance, the same guarantee the sheet's own rows rely on.
  */
  const reduceMotion = useReducedMotion();
  const y = useMotionValue(0);
  // Fades the WHOLE takeover (backdrop included) as it's dragged, so the app
  // underneath becomes visible through it — the visual promise a drag-to-close
  // gesture makes before the finger ever lifts.
  const dragOpacity = useTransform(y, [0, 500], [1, 0.35]);
  const [closingStory, setClosingStory] = useState(false);
  const handleDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    const DISMISS_DISTANCE = 130;
    const DISMISS_VELOCITY = 650;
    if (info.offset.y <= DISMISS_DISTANCE && info.velocity.y <= DISMISS_VELOCITY) return; // snaps back to 0 on its own (dragConstraints)
    haptic("light");
    setClosingStory(true);
    if (reduceMotion) {
      onClose();
      return;
    }
    // Finishes the gesture rather than teleporting: a quick tween off the
    // bottom edge from wherever the finger let go, same `animate(value, target,
    // transition).then(...)` idiom `reel-viewer.tsx` already uses for its own
    // release animations.
    void animate(y, typeof window === "undefined" ? 1200 : window.innerHeight, {
      type: "tween",
      duration: 0.22,
      ease: "easeIn",
    }).then(() => onClose());
  };

  if (!story) return null;

  /*
    Portalled to <body> by the viewer ITSELF, so every surface that opens it gets the same
    answer (owner, 2026-10-15: the bottom nav was still showing over the story on the feed
    and the message page). Rendered in place it sat inside a scroll or transform ancestor
    whose stacking context trapped this z-[95] UNDER the z-40 bottom nav. From <body> the
    viewer covers the nav entirely and the reply box is the last thing on the screen.

    ── The Story Viewer design (design/Frenz-Story-Viewer-design.zip, 2026-10-26) ──
    StoryWatching.dc.html (someone else's) and StoryYours.dc.html (yours), at their
    proportions: the picture is a card with 28 px bottom corners ending above a black
    band (92 px on a 844 px phone: 58 px of controls + the home-indicator inset); the
    progress bar and the header float on it under a dark top fade; the quick reactions
    sit on its foot; the band holds the reply box (theirs) or who saw it (yours).

    🔴 Lightweight on purpose (owner: "never slow or overheat"): the design's frosted
    buttons are drawn as a tinted fill with NO backdrop-filter — six blurred circles over
    a PLAYING video re-blur every frame, which is exactly the cost this viewer has always
    refused (see the progress bar note below). The sheets that open over a paused story
    keep their glass.
  */
  const firstName = group.displayName.split(" ")[0] || group.displayName;
  const viewersReady = ownViewers.status === "ready" ? ownViewers.data : null;
  return createPortal(
    <motion.div
      ref={rootRef}
      className="frenz-ui fixed inset-0 z-[95] bg-black !text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Story from ${group.displayName}`}
      style={{ y, opacity: reduceMotion ? 1 : dragOpacity, ["--story-band" as string]: "calc(3.625rem + max(env(safe-area-inset-bottom), 0.75rem))" }}
      // Off while replying, not just the close callback — otherwise the panel
      // still visually drags under a thumb that's trying to select/caret text
      // in the composer, it just silently fails to close at the end of it.
      // Same window that already pauses the story's own video.
      drag={closingStory || replying || reduceMotion ? false : "y"}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.9 }}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
    >
      {paidCard ? <SelfStoryCard ad={paidCard} onDone={() => setPaidCard(null)} /> : null}
      <WowBurst burstKey={wowKey} anchorRef={rootRef} />
      {rise ? <EmojiRise key={rise.id} emoji={rise.emoji} onDone={() => setRise(null)} /> : null}

      {/*
        ── 🔴 THE MEDIA STOPS AT THE SAFE AREA; THE CHROME FLOATS ON IT ──────
        (owner, 2026-10-04, with a screenshot of the Dynamic Island): the picture
        begins where the status bar ends and never passes behind it; the progress
        bar and the header lie ON it. The design's card keeps that top line and
        ends above the band (owner, 2026-10-08: "the bottom should be comment,
        react and all") — now in the browser too, as the design draws it.
      */}
      <section
        aria-label={`Story ${si + 1} of ${group.stories.length}`}
        className="absolute inset-x-0 overflow-hidden rounded-b-[28px] bg-[#0B0920]"
        style={{ top: "var(--frenz-safe-top, 0px)", bottom: "var(--story-band)" }}
      >
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          {story.mediaKind === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              key={`${gi}-${si}`}
              src={story.mediaUrl}
              // The stored first frame (0083) paints immediately while the video
              // buffers, instead of a black rectangle — and it's already in the
              // image cache from the ring the user just tapped.
              poster={story.thumbnailUrl ?? undefined}
              autoPlay
              playsInline
              muted={muted}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setPct((v.currentTime / v.duration) * 100);
                // sound but no picture: the phone can't draw this video's codec — stop it (see "NO SOUND WITHOUT THE STORY")
                if (!noPicture && v.currentTime > 1.5 && (v.videoWidth === 0 || v.getVideoPlaybackQuality?.().totalVideoFrames === 0)) {
                  v.pause();
                  setNoPicture(true);
                }
              }}
              onEnded={next}
              onLoadedMetadata={(e) => setFillFrame(e.currentTarget.videoHeight > e.currentTarget.videoWidth)}
              className={cn("h-full w-full", fillFrame ? "object-cover" : "object-contain")}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${gi}-${si}`}
              src={story.mediaUrl}
              alt=""
              onLoad={(e) => setFillFrame(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth)}
              className={cn("h-full w-full", fillFrame ? "object-cover" : "object-contain")}
            />
          )}
        </div>
        {noPicture ? (
          <p role="status" className="pointer-events-none absolute inset-x-6 top-1/2 z-[2] -translate-y-1/2 rounded-2xl bg-black/60 px-4 py-3 text-center text-[14px] font-semibold text-white">
            This video can&apos;t play on this device.
          </p>
        ) : null}

        {/* the design's fades: the header reads on any picture; the reactions on theirs */}
        <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 z-[1] h-[170px] bg-[linear-gradient(180deg,rgba(8,6,20,0.62)_0%,rgba(8,6,20,0.3)_55%,rgba(8,6,20,0)_100%)] transition-opacity duration-150", holding && "opacity-0")} />
        {!isOwn ? (
          <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[140px] bg-[linear-gradient(0deg,rgba(8,6,20,0.55)_0%,rgba(8,6,20,0)_100%)] transition-opacity duration-150", holding && "opacity-0")} />
        ) : null}

        {/*
          tap zones: left third = back, the rest = forward (the whole picture).
          Also the hold surface — press either zone and hold past 220ms to clear
          the screen; release before that and it's an ordinary tap. `onClick`
          checks `wasHold` because a hold's release still fires a click event,
          which must NOT also navigate.
        */}
        <button
          type="button"
          aria-label="Previous (hold to rewind at 2x)"
          onPointerDown={() => startHold("back")}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onClick={() => zoneTap(prev)}
          className="absolute inset-y-0 left-0 z-10 w-1/3"
        />
        <button
          type="button"
          aria-label="Next (hold to play at 2x)"
          onPointerDown={() => startHold("forward")}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onClick={() => zoneTap(next)}
          className="absolute inset-y-0 left-1/3 right-0 z-10"
        />

        {/*
          ── The segmented bar (owner, 2026-10-04): one segment per story, so the
          COUNT IS THE BAR. The design's 3 px segments, 4 px apart, 12 px in.
          🔴 No backdrop-blur and no gradient here, deliberately: this element sits
          over every frame of a playing video. The current segment is driven by a
          RAF/timeupdate already, so only the others transition.
        */}
        <div
          className={cn("absolute inset-x-3 top-2.5 z-20 flex gap-1 transition-opacity duration-150", holding && "opacity-0")}
          role="progressbar"
          aria-label={`Story ${si + 1} of ${group.stories.length}`}
          aria-valuemin={0}
          aria-valuemax={group.stories.length}
          aria-valuenow={si + 1}
        >
          {group.stories.map((_, idx) => (
            <span key={idx} className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-white/[0.32] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
              <span
                className={cn(
                  "block h-full bg-white",
                  idx !== si && "transition-[width] duration-200",
                  // an IMAGE segment moves in 2 % steps (Part 9) - a linear 120 ms glide hides the steps; a video's bar follows timeupdate untransitioned
                  idx === si && story.mediaKind !== "video" && "transition-[width] duration-[120ms] ease-linear",
                )}
                style={{ width: `${idx < si ? 100 : idx === si ? pct : 0}%` }}
              />
            </span>
          ))}
        </div>

        {/* the author, when, the sound — and the three round buttons (sound, options, close) */}
        <header className={cn("absolute left-3 right-2 top-[22px] z-20 flex items-center gap-2.5 transition-opacity duration-150", holding && "pointer-events-none opacity-0")}>
          <span aria-hidden className="flex h-[42px] w-[42px] shrink-0 rounded-full bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4_55%,#C23FD1)] p-[2px]">
            <span className="flex flex-1 items-center justify-center overflow-hidden rounded-full border-2 border-[#0B0920] bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4)] font-heading text-[16px] font-extrabold text-white">
              {group.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={group.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                group.displayName.charAt(0).toUpperCase()
              )}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px] [text-shadow:0_1px_6px_rgba(0,0,0,0.4)]">
            <span className="flex min-w-0 items-center gap-[5px]">
              <span className="truncate text-[15px] font-extrabold">{group.displayName}</span>
              {group.isVerified ? <VerifiedMark /> : null}
              <span className="shrink-0 text-[13px] font-semibold text-white/[0.82]">{shortAgo(story.createdAt)}</span>
            </span>
            {story.mediaKind === "video" ? (
              <span className="flex min-w-0 items-center gap-[5px] text-[12px] font-semibold text-white/[0.88]">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="shrink-0">
                  <path d="M4 10v4" />
                  <path d="M8 7v10" />
                  <path d="M12 4v16" />
                  <path d="M16 8v8" />
                  <path d="M20 11v2" />
                </svg>
                <span className="truncate">Original audio · {firstName}</span>
              </span>
            ) : null}
          </span>
          {/* the sound button only where there is sound — a speaker on a photo would do nothing */}
          {story.mediaKind === "video" ? (
            <GlassButton label={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
              {muted ? (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  <path d="M17 9l5 6" />
                  <path d="M22 9l-5 6" />
                </svg>
              ) : (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  <path d="M16.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M19 6a8.5 8.5 0 0 1 0 12" />
                </svg>
              )}
            </GlassButton>
          ) : null}
          <GlassButton label="Story options" onClick={() => setOptionsOpen(true)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </GlassButton>
          <GlassButton label="Close" onClick={onClose}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </GlassButton>
        </header>

        {holding ? (
          <div className="pointer-events-none absolute left-1/2 top-[76px] z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[13px] font-bold text-white" aria-live="polite">
            {holding === "back" ? <Rewind className="h-4 w-4 fill-white" aria-hidden /> : null}
            2×
            {holding === "forward" ? <FastForward className="h-4 w-4 fill-white" aria-hidden /> : null}
          </div>
        ) : null}

        {story.caption ? (
          <p
            className={cn(
              "pointer-events-none absolute inset-x-0 z-[15] px-6 text-center text-sm text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] transition-opacity duration-150",
              !isOwn && allowReplies ? "bottom-[68px]" : "bottom-5",
              holding && "opacity-0",
            )}
          >
            {story.caption}
          </p>
        ) : null}

        {/* the design's quick reactions on the foot of the picture — each one a reaction the author can count (0288) */}
        {!isOwn && allowReplies && !replying ? (
          <div role="group" aria-label="Quick reactions" className={cn("absolute inset-x-4 bottom-4 z-20 flex justify-center gap-2 transition-opacity duration-150", holding && "pointer-events-none opacity-0")}>
            {QUICK_REACTIONS.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => {
                  haptic("light");
                  setRise({ id: Date.now(), emoji: r.emoji });
                  void postStoryReply(group.userId, r.emoji, { storyId: story.id, reaction: true });
                }}
                className="flex h-10 items-center gap-1.5 rounded-[20px] border border-white/[0.22] bg-[rgba(18,17,26,0.42)] px-3.5 text-[13px] font-bold text-white transition active:scale-95"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={r.icon} />
                </svg>
                {r.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── the band: who saw it (yours) · the reply box (theirs) ── */}
      {isOwn ? (
        <nav
          aria-label="Your story"
          className={cn("absolute inset-x-0 bottom-0 z-30 flex items-start gap-2 pl-4 pr-3 transition-opacity duration-150", holding && "pointer-events-none opacity-0")}
          style={{ height: "var(--story-band)" }}
        >
          <button type="button" onClick={() => setViewersOpen(true)} className="flex h-[3.625rem] min-w-0 flex-1 items-center gap-2.5 text-left">
            {viewersReady && viewersReady.viewers.length > 0 ? (
              <span aria-hidden className="flex shrink-0">
                {viewersReady.viewers.slice(0, 3).map((v, i) => (
                  <span key={v.id} className={cn("h-[30px] w-[30px] overflow-hidden rounded-full border-2 border-black", i > 0 && "-ml-2.5")}>
                    <ViewerFace id={v.id} avatarUrl={v.avatarUrl} name={v.displayName ?? v.handle} />
                  </span>
                ))}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1 text-[15px] font-extrabold">
                {viewersReady ? `${viewersReady.totals.viewers.toLocaleString()} ${viewersReady.totals.viewers === 1 ? "viewer" : "viewers"}` : "Seen by"}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </span>
              <span className="truncate text-[12px] font-semibold text-[#A9A6BD]">
                {viewersReady ? viewersLine(viewersReady) : ownViewers.status === "error" ? "Tap to see who viewed it" : "Loading…"}
              </span>
            </span>
          </button>
          <button type="button" onClick={() => setHighlighting(true)} className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-[5px] text-[11px] font-bold">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16.5s-4-2.4-4-5.3A2.2 2.2 0 0 1 12 10a2.2 2.2 0 0 1 4 1.2c0 2.9-4 5.3-4 5.3z" />
              </svg>
            </span>
            Highlight
          </button>
          <button type="button" onClick={() => setSendOpen(true)} className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-[5px] text-[11px] font-bold">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4)] shadow-[0_8px_18px_-8px_rgba(91,63,240,0.8)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4z" />
              </svg>
            </span>
            Share
          </button>
        </nav>
      ) : holding ? null : (
        <StoryReplyBar
          toUserId={group.userId}
          storyId={story.id}
          name={firstName}
          allowReplies={allowReplies}
          canShare={effectiveAllow}
          coinGift={entitlementsReady && frenzCoin ? `/wallet/transfer?to=${encodeURIComponent(group.userId)}&story=${encodeURIComponent(story.id)}` : null}
          onShare={() => setResharing(true)}
          onFocusChange={setReplying}
          onEmoji={(emoji) => setRise({ id: Date.now(), emoji })}
        />
      )}

      {/* kept mounted once opened: "Send to chat" and "Report" close the sheet and open their own — unmounting it lost them */}
      {optionsUsed ? (
        <StoryOptions
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          story={story}
          group={group}
          isOwn={isOwn}
          allowShare={effectiveAllow}
          allowReplies={allowReplies}
          onToggleReshare={() => void toggleAllowReshare()}
          onToggleReplies={() => void toggleAllowReplies()}
          onSeenBy={() => setViewersOpen(true)}
          onReshare={() => setResharing(true)}
          // the same path as a story that ends or is withdrawn (Part 3): the next one slides in, every surface drops it
          onDeleted={(id) => dropStories([id])}
          onHighlight={() => setHighlighting(true)}
        />
      ) : null}

      {/* Stories Part 5: keep your own story in a highlight (loaded on the first tap) */}
      {highlighting && isOwn ? <HighlightPicker open onClose={() => setHighlighting(false)} userId={group.userId} storyId={story.id} /> : null}

      <ReshareSheet
        open={resharing}
        onClose={() => setResharing(false)}
        source="story"
        sourceId={story.id}
        mediaKind={story.mediaKind}
        previewUrl={story.mediaKind === "image" ? story.mediaUrl : story.thumbnailUrl}
      />

      {sendOpen ? (
        <SendToChatSheet
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          blob={null}
          // straight from the media CDN, only when a chat is picked
          resolveBlob={async () => fetch(story.mediaUrl).then((r) => (r.ok ? r.blob() : null)).catch(() => null)}
          kind={story.mediaKind}
          title={story.caption?.trim() || `${group.displayName}'s story`}
          thumbnailUrl={story.mediaKind === "image" ? story.mediaUrl : (story.thumbnailUrl ?? null)}
        />
      ) : null}

      {/*
        ── "Seen by" — the author's own story only (2026-10-04) ──────────────
        Rendered only for `isOwn`: the route refuses anyone else and RLS refuses
        them underneath that, but offering a control that will 403 is worse than
        not offering it. The sheet reads nothing until it is opened.
      */}
      {isOwn ? (
        <StoryViewersSheet
          storyId={story.id}
          open={viewersOpen}
          onClose={() => setViewersOpen(false)}
          stories={group.stories}
          currentIndex={si}
          onPick={(i) => {
            setPct(0);
            setSi(i);
          }}
        />
      ) : null}
    </motion.div>,
    document.body,
  );
}

/** The design's quick reactions — the label it shows, and the emoji the author receives. */
const QUICK_REACTIONS = [
  { label: "Love it", emoji: "😍", icon: "M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z" },
  { label: "Fire", emoji: "🔥", icon: "M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.6 1.1 2.6 2.2 2.6C10.5 8.5 11 5.5 12 3z" },
  { label: "Wow", emoji: "😮", icon: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" },
] as const;

/** "26s", "4m", "2h" — the design's header time. Stories live 24 h, so hours is the largest unit. */
function shortAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** The design's round header button: a dark tint and a hairline, no backdrop-filter (see the note on the viewer). */
function GlassButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/[0.22] bg-[rgba(18,17,26,0.42)] text-white transition active:scale-95"
    >
      {children}
    </button>
  );
}

function VerifiedMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" role="img" aria-label="Verified" className="shrink-0">
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z" fill="#3D5AFE" />
      <path d="M8 12.2l2.6 2.6L16 9.4" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A viewer's face in the bottom bar: their photo, or their initial on the design's gradient. */
function ViewerFace({ id, avatarUrl, name }: { id: string; avatarUrl: string | null; name: string | null }) {
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a 30px remote avatar
    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-[12px] font-bold text-white" style={{ background: faceGradient(id) }}>
      {(name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * A story reply, delivered as a DM to the author (/api/stories/reply). With the
 * story named, the route checks the reader may see it and that replies are on
 * (0288); a `reaction` is counted for the author's "Seen by".
 */
async function postStoryReply(toUserId: string, text: string, opts: { storyId?: string; reaction?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/stories/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Part 4 (B6): one key per reply — a resent request returns the same message, never a second one or a second push
      body: JSON.stringify({ toUserId, text, ...opts, clientId: crypto.randomUUID() }),
    });
    if (r.ok) return { ok: true };
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: d?.error };
  } catch {
    return { ok: false };
  }
}

/**
 * Seven copies of the emoji rise from the reply bar and fade, at staggered heights and
 * sideways drifts — Instagram's quick-reaction flourish. Pointer-transparent; one fade
 * when the viewer prefers reduced motion.
 */
const RISE = [
  { x: -34, h: 0.56, d: 0, r: -14 },
  { x: 22, h: 0.68, d: 0.06, r: 10 },
  { x: -8, h: 0.78, d: 0.12, r: -4 },
  { x: 36, h: 0.5, d: 0.18, r: 16 },
  { x: -22, h: 0.64, d: 0.24, r: -10 },
  { x: 10, h: 0.72, d: 0.3, r: 6 },
  { x: -40, h: 0.6, d: 0.36, r: -18 },
];
function EmojiRise({ emoji, onDone }: { emoji: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = window.setTimeout(onDone, reduce ? 900 : 2200);
    return () => window.clearTimeout(t);
  }, [onDone, reduce]);
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center" aria-hidden>
      {(reduce ? RISE.slice(0, 1) : RISE).map((p, i) => (
        <motion.span
          key={i}
          className="absolute text-[44px] leading-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]"
          initial={{ opacity: 0, y: 0, x: 0, scale: 0.5, rotate: 0 }}
          animate={reduce ? { opacity: [0, 1, 0], scale: 1 } : { opacity: [0, 1, 1, 0], y: -vh * p.h, x: `${p.x}vw`, scale: [0.5, 1.25, 1], rotate: p.r }}
          transition={{ duration: reduce ? 0.8 : 1.6, delay: reduce ? 0 : p.d, ease: [0.22, 1, 0.36, 1] }}
        >
          {emoji}
        </motion.span>
      ))}
    </div>
  );
}

/**
 * ── The reply band (the Story Viewer design, StoryWatching.dc.html) ──────────
 * One outlined pill — "Reply to Ada…" with the coin button inside it — then the
 * heart and the paper plane. Typing swaps the heart and the plane for Send.
 *
 *   coin    sends Frenz Coin to the author FOR this story (owner, 2026-10-26: "should
 *           be gifting of Frenz coin not AI credit"): the ordinary transfer screen,
 *           with the story named so their notification opens it (lib/coin/story-gift.ts).
 *           Shown only while Frenz Coin is switched on.
 *   heart   a like: one ❤️ reaction to the author, once per story
 *   plane   reshare / send to a chat — only when the author allows resharing
 *
 * With the author's "Allow replies" off, the pill says so and takes no text.
 */
function StoryReplyBar({
  toUserId,
  storyId,
  name,
  allowReplies,
  canShare,
  coinGift,
  onShare,
  onFocusChange,
  onEmoji,
}: {
  toUserId: string;
  storyId: string;
  name: string;
  allowReplies: boolean;
  canShare: boolean;
  /** the transfer screen for a gift to this story, or null (Frenz Coin off) */
  coinGift: string | null;
  onShare: () => void;
  onFocusChange: (v: boolean) => void;
  /** the reply was one emoji: the viewer plays its rise */
  onEmoji?: (emoji: string) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [liked, setLiked] = useState<ReadonlySet<string>>(() => new Set());

  const send = async (payload: string) => {
    const t = payload.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    // the rise plays on the tap itself, not after the network answers
    const single = isSingleEmoji(t);
    if (single) {
      haptic("light");
      onEmoji?.(t);
    }
    const out = await postStoryReply(toUserId, t, { storyId, reaction: single });
    if (out.ok) {
      setSent(true);
      setTimeout(() => setSent(false), 1600);
    } else if (out.error) toast(out.error, "error");
    setBusy(false);
  };

  const like = () => {
    if (liked.has(storyId)) return;
    setLiked((prev) => new Set(prev).add(storyId));
    haptic("light");
    onEmoji?.("❤️");
    void postStoryReply(toUserId, "❤️", { storyId, reaction: true });
  };

  const typing = text.trim().length > 0;
  const isLiked = liked.has(storyId);
  return (
    <form
      aria-label={`Reply to ${name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send(text);
      }}
      className="absolute inset-x-0 bottom-0 z-30 flex items-start gap-2 px-3"
      style={{ height: "var(--story-band)" }}
    >
      {sent ? <p className="absolute -top-6 inset-x-0 text-center text-xs font-semibold text-emerald-300">Sent to {name} ✓</p> : null}
      <div className="flex h-[3.625rem] min-w-0 flex-1 items-center">
        <label className="flex h-[50px] min-w-0 flex-1 items-center gap-2 rounded-[25px] border border-white/[0.32] pl-[18px] pr-1.5">
          <span className="sr-only">Reply</span>
          {allowReplies ? (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => onFocusChange(true)}
              onBlur={() => onFocusChange(false)}
              maxLength={500}
              placeholder={`Reply to ${name}…`}
              data-large-text
              // 16 px, never less: iOS Safari ZOOMS the page into any input under 16 px when it is focused (2026-10-26)
              className="h-full min-w-0 flex-1 border-none bg-transparent !text-[16px] text-white outline-none placeholder:text-white/[0.78]"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[15px] text-white/60">Replies are off</span>
          )}
          {coinGift && !typing ? (
            <Link
              href={coinGift}
              // warmed as soon as the reply bar shows it (the viewer only ever opens after a tap, never during a page load)
              aria-label={`Send Frenz Coin to ${name} for this story`}
              // the screen starts loading as the finger lands — a tap's ~100 ms head start (2026-10-26: "open faster")
              onPointerDown={() => router.prefetch(coinGift)}
              onClick={() => {
                // Back from the transfer comes back to THIS story: the page's address names it (stories-row.tsx reads ?story=)
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set("story", storyId);
                  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
                } catch {
                  /* the transfer still opens */
                }
              }}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-white transition active:scale-95"
            >
              {/* the spinner answers the tap on the same frame, until the transfer screen opens */}
              <TapPending size={17}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v10" />
                  <path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5" />
                </svg>
              </TapPending>
            </Link>
          ) : null}
        </label>
      </div>
      {typing ? (
        <div className="flex h-[3.625rem] items-center">
          <button
            type="submit"
            disabled={busy}
            aria-label="Send reply"
            className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4)] text-white transition disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        <div className="flex h-[3.625rem] items-center">
          {allowReplies ? (
            <button type="button" onClick={like} aria-label={isLiked ? "Liked" : "Like story"} aria-pressed={isLiked} className="flex h-[50px] w-[50px] shrink-0 items-center justify-center text-white transition active:scale-110">
              <svg width="26" height="26" viewBox="0 0 24 24" fill={isLiked ? "#FF3B6B" : "none"} stroke={isLiked ? "#FF3B6B" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z" />
              </svg>
            </button>
          ) : null}
          {canShare ? (
            <button type="button" onClick={onShare} aria-label="Share story" className="flex h-[50px] w-[50px] shrink-0 items-center justify-center text-white transition active:scale-95">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4z" />
              </svg>
            </button>
          ) : null}
        </div>
      )}
    </form>
  );
}
