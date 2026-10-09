"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Eye, Loader2, MoreHorizontal, Plus, Repeat2, Send, Smile, X } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { useSelfAdPool } from "@/features/ads-platform/serve/use-self-ad-pool";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { seed, useQuery } from "@/features/data";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { ReshareSheet } from "@/features/social/reshare-sheet";
import { StoryViewersSheet } from "@/features/social/story-viewers-sheet";
import { toast } from "@/features/ui/toast";
import { formatRelative } from "@/lib/i18n/format";
import { haptic } from "@/lib/motion/haptics";
import { fetchStoryGroups, readCachedStories, writeCachedStories } from "@/lib/social/story-cache";
import type { StoryGroup } from "@/lib/social/stories";
import { isGroupSeen, loadSeenMap, markGroupSeen, type SeenMap } from "@/lib/social/story-seen";
import { cn } from "@/lib/utils";

const QUICK_EMOJI = ["❤️", "😂", "😮", "😍", "🔥", "👏", "🙌"];
const STICKERS = ["🎉", "💯", "😭", "🥰", "😎", "🤯", "👀", "🫶", "💀", "🤝", "✨", "🙏"];

const IMAGE_MS = 5000;

/**
 * One story circle. Shared by the viewer's own row and the friends row so the
 * two can never drift apart visually.
 */
// Ad Platform Part 5: a paid card between two people's Stories — fetched only when one shows.
// The ••• sheet (send to chat, save, seen by, delete / report) — fetched on the first tap.
const StoryOptions = dynamic(() => import("@/features/social/story-options").then((m) => m.StoryOptions), { ssr: false });

const SelfStoryCard = dynamic(() => import("@/features/ads-platform/serve/self-story-card").then((m) => m.SelfStoryCard), { ssr: false });

/*
  Ring sizes. `compact` is the Messages inbox (2026-10-09 reference: "smaller
  stories section — reduced height, compact avatar, more space for chats"):
  60px avatars in 72px columns instead of 68 / 82. /home keeps the full size.
*/
const AV = "h-[4.25rem] w-[4.25rem]";
const AV_COMPACT = "h-[3.75rem] w-[3.75rem]";
const COL = "w-[5.1rem]";
const COL_COMPACT = "w-[4.5rem]";

function StoryRing({
  group,
  label,
  unseen,
  onOpen,
  compact = false,
}: {
  group: StoryGroup;
  label: string;
  unseen: boolean;
  onOpen: () => void;
  compact?: boolean;
}) {
  const av = compact ? AV_COMPACT : AV;
  const col = compact ? COL_COMPACT : COL;
  // Show the story's own cover (most recent first) in the circle so it teases
  // the content — not the author's profile picture.
  const cover = group.stories[0];
  // An image story is its own cover; a video story uses the poster stored at
  // upload (0083). Either way the ring paints an <img>, never a <video>.
  const coverImage = cover?.mediaKind === "image" ? cover.mediaUrl : (cover?.thumbnailUrl ?? null);

  return (
    <PressIcon className="shrink-0">
      <button type="button" onClick={onOpen} className={cn("flex flex-col items-center", col, compact ? "gap-1" : "gap-1.5")}>
        <span className={cn("rounded-full p-0.5", unseen ? "bg-brand" : "ring-1 ring-inset ring-border/70")}>
          <span className="block overflow-hidden rounded-full bg-background p-0.5">
            {/* One <Image> for BOTH image stories and video stories (via the
                stored first-frame poster, 0083). `bg-secondary` paints a neutral
                fill the instant the ring mounts, so a video story's cover never
                sits empty-white while next/image decodes — it reads as instant,
                exactly like a photo story (owner, 2026-07-21: "video stories take
                time to show the thumbnail … make it show instant like a picture").
                We deliberately NEVER stream the MP4 to paint this 68px circle: the
                old `<video preload="metadata">` fallback for a missing poster
                downloaded real video data just for the thumbnail — the "loads
                slow / is large" the owner saw. A video story with no poster now
                falls straight through to the author's avatar (instant). */}
            {coverImage ? (
              <Image
                src={coverImage}
                alt=""
                width={68}
                height={68}
                unoptimized={false}
                className={cn(av, "rounded-full bg-secondary object-cover")}
              />
            ) : group.avatarUrl ? (
              <Image src={group.avatarUrl} alt="" width={68} height={68} className={cn(av, "rounded-full bg-secondary object-cover")} />
            ) : (
              <span className={cn(av, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white")}>
                {group.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </span>
        <span className={cn(col, "truncate text-center text-[11px]", unseen ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
          {label}
        </span>
      </button>
    </PressIcon>
  );
}

export function StoriesRow({
  initialGroups,
  viewerAvatarUrl,
  viewerName,
  viewerHandle,
  compact = false,
}: {
  initialGroups?: StoryGroup[];
  viewerAvatarUrl?: string | null;
  viewerName?: string;
  viewerHandle?: string | null;
  /** The Messages inbox's smaller rings — see AV_COMPACT. */
  compact?: boolean;
}) {
  const av = compact ? AV_COMPACT : AV;
  const router = useRouter();
  // Seeded from the server + cached-first: paints instantly, refreshed in
  // background. `initialGroups` is only present where the row is server-rendered
  // (/home, /friends); on the inbox it's client-only, so it falls back to the
  // last-known rings persisted on disk rather than an empty strip that fills in
  // seconds later (owner, 2026-07-16 — see lib/social/story-cache.ts). The disk
  // copy self-expires at 24h, so a stale entry can never paint a phantom ring.
  // `revalidateOnFocus: false` — the Stories row must NOT refetch on an iOS
  // back-swipe / app resume. On /messages it lives in the persistent shell
  // (InboxMobileChrome) and the owner's report was specifically that Stories
  // "flash / reload on swipe back" — a focus refetch is what caused it. It still
  // loads on mount (each /home entry, first /messages entry) and paints
  // cache-first, so it stays frozen between genuine loads instead of reloading.
  const { data } = useQuery<StoryGroup[]>("stories", fetchStoryGroups, {
    initialData: initialGroups,
    revalidateOnFocus: false,
  });
  const groups = data ?? [];

  // Disk seed, applied AFTER mount — never during render. This component is
  // server-rendered, and the server has no localStorage, so reading it in the
  // render pass would hand React different markup on the client and trip a
  // hydration mismatch (the same trap the seen/unseen rings below already
  // document). Seeding in an effect costs one frame instead of the several
  // SECONDS the network took, which is the whole complaint. Only fills a gap:
  // if the row is server-seeded (/home, /friends) or the shared cache is
  // already warm, this does nothing.
  useEffect(() => {
    if (initialGroups?.length || groups.length > 0) return;
    const cached = readCachedStories();
    // `seed`, not `mutate`: mutate() bumps the cache entry's version, and
    // useQuery's own effect has ALREADY started a revalidation by the time this
    // runs (hook order). That fetch captured the pre-seed version, so on arrival
    // it saw a version bump, concluded it was stale, and threw the fresh server
    // data away — leaving the rings on the disk copy until some later focus or
    // reconnect revalidation. The version guard is right for user writes (it's
    // what stops a slow GET clobbering a toggle); a disk seed is not a user
    // write, so it must not pretend to be one.
    if (cached?.length) seed<StoryGroup[]>("stories", cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; the fetch below is the authority from then on
  }, []);
  const [start, setStart] = useState<number | null>(null);
  const initial = (viewerName ?? "").charAt(0).toUpperCase() || "+";

  // Server groups sort the viewer's own stories first when present — surfaced
  // once as a dedicated "Your Story" card, not a second time in the row below.
  const ownGroup = viewerHandle ? groups.find((g) => g.handle === viewerHandle) : undefined;
  const otherGroups = ownGroup ? groups.filter((g) => g !== ownGroup) : groups;

  // Seen/unseen rings: hydration-safe default (everything reads "unseen" on
  // first paint, same on server and client) then refined from localStorage
  // right after mount — avoids a server/client markup mismatch.
  const [seen, setSeen] = useState<SeenMap>({});
  useEffect(() => setSeen(loadSeenMap()), [data]);

  return (
    <div className={cn("-mx-1 flex overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", compact ? "gap-2.5" : "gap-4")}>
      {/* Order is the owner's, 2026-07-16: "i want it in the same line with other
          stories but it should be the first" —
            [+ Add story] [Your story] [friends…]
          Your own story is a normal ring in the SAME row, just first; the plus
          is a separate, dedicated upload button ahead of it.

          The plus is ALWAYS the composer — never a viewer. It used to open your
          own story the moment you had one, which meant that once you'd posted
          there was no way left to post another ("the stories doesnt post from
          the plus sign when a story is already there"). Splitting the upload
          button from your story ring is what makes both jobs reachable.
          No brand ring on the plus, for the same reason: nothing there is
          watchable. */}
      <PressIcon className="shrink-0">
        <button
          type="button"
          onClick={() => router.push("/create/story")}
          aria-label="Add to your story"
          className={cn("flex flex-col items-center", compact ? cn(COL_COMPACT, "gap-1") : cn(COL, "gap-1.5"))}
        >
          <span className="relative rounded-full p-0.5 ring-1 ring-inset ring-border/70">
            <span className="block rounded-full bg-background p-0.5">
              {viewerAvatarUrl ? (
                <Image src={viewerAvatarUrl} alt="" width={68} height={68} className={cn(av, "rounded-full object-cover")} />
              ) : (
                <span className={cn(av, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white")}>
                  {initial}
                </span>
              )}
            </span>
            <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-background", compact ? "h-6 w-6" : "h-7 w-7")}>
              <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </span>
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">Add story</span>
        </button>
      </PressIcon>

      {/* Yours first, then everyone else. Always reads as "unseen" (brand ring):
          greying out your own story the moment you watch it back makes a live
          story look expired. */}
      {ownGroup ? (
        <StoryRing group={ownGroup} label="Your story" unseen compact={compact} onOpen={() => setStart(groups.indexOf(ownGroup))} />
      ) : null}

      {otherGroups.map((g) => (
        <StoryRing key={g.handle} group={g} label={g.displayName.split(" ")[0] ?? ""} unseen={!isGroupSeen(g, seen)} compact={compact} onOpen={() => setStart(groups.indexOf(g))} />
      ))}

      {start !== null ? (
        <StoryViewer groups={groups} startGroup={start} onClose={() => setStart(null)} onGroupSeen={() => setSeen(loadSeenMap())} />
      ) : null}
    </div>
  );
}

export function StoryViewer({
  groups: incomingGroups,
  startGroup,
  onClose,
  onGroupSeen,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
  /** Fired once per group after it's marked seen (ring-state refresh in the row). */
  onGroupSeen?: () => void;
}) {
  /*
    Stories the author deleted from here (owner, 2026-10-08). Filtered locally
    so the viewer moves on at once whichever surface opened it (the home row,
    Friends, a chat), and the shared "stories" cache is updated for the rest.
  */
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(
    () =>
      deletedIds.size === 0
        ? incomingGroups
        : incomingGroups.map((g) => ({ ...g, stories: g.stories.filter((x) => !deletedIds.has(x.id)) })).filter((g) => g.stories.length > 0),
    [incomingGroups, deletedIds],
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [gi, setGi] = useState(startGroup);
  /*
    Ad Platform Part 5 (placement stories_card): BETWEEN two people's stories,
    never inside one, at most once per the format's admin gap. The story under
    it is paused until it is done; with no live campaign this is an empty pool
    and nothing changes.
  */
  const storyAds = useSelfAdPool("stories_card", "stories");
  const [paidCard, setPaidCard] = useState<EligibleAd | null>(null);
  const [si, setSi] = useState(0);
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
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHold = useRef(false);
  const startHold = useCallback(() => {
    wasHold.current = false;
    holdTimer.current = setTimeout(() => {
      wasHold.current = true;
      haptic("light");
      setHolding(true);
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
  const { handle } = useEntitlements();

  const group = groups[gi]!;
  const story = group?.stories[si];
  const isOwn = !!handle && group.handle === handle;

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

  // Mark the group seen as soon as it's opened (matches how Instagram-style
  // rings behave — opening counts as "seen", not finishing every segment).
  useEffect(() => {
    if (!group) return;
    markGroupSeen(group);
    onGroupSeen?.();
  }, [group, onGroupSeen]);

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
    const next = group.stories[si + 1] ?? groups[gi + 1]?.stories[0];
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
  */
  useEffect(() => {
    if (!story || isOwn) return;
    void fetch(`/api/stories/${encodeURIComponent(story.id)}/views`, { method: "POST", keepalive: true }).catch(() => {});
  }, [story, isOwn]);

  const next = useCallback(() => {
    setPct(0);
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) {
      // the next paid card that may show now (never the last one, within the admin gap)
      const ad = storyAds.status === "ready" ? storyAds.take() : null;
      if (ad) setPaidCard(ad);
      setGi(gi + 1);
      setSi(0);
    } else onClose();
  }, [si, gi, group, groups.length, onClose, storyAds]);

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
    if (!story || story.mediaKind === "video" || replying || holding || paidCard || optionsOpen) return;
    const startedAt = performance.now() - elapsedRef.current;
    let raf = 0;
    const tick = (now: number) => {
      elapsedRef.current = now - startedAt;
      const p = Math.min(100, (elapsedRef.current / IMAGE_MS) * 100);
      setPct(p);
      if (p >= 100) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gi, si, story, next, replying, holding, paidCard, optionsOpen]);

  // Pause the story video while replying, or held for a clear look.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (replying || holding || paidCard || optionsOpen) v.pause();
    else void v.play().catch(() => {});
  }, [replying, holding, paidCard, optionsOpen, gi, si]);

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

  return (
    <motion.div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      style={{ y, opacity: reduceMotion ? 1 : dragOpacity }}
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
      {/*
        Every piece of chrome below fades out together while `holding` —
        "full clear screen on press and hold" (owner, 2026-08-16). One class
        on each element rather than one wrapping div: several of these are
        already individually `absolute`-positioned at their own coordinates
        (progress bar, author row, buttons), and wrapping them would either
        collapse that positioning or require re-deriving it on a new parent.
        `pointer-events-none` while hidden so a hold-release near a button's
        old position can't register a stray tap on chrome that isn't visible.
      */}
      <div
        className={cn(
          "absolute right-4 top-[calc(1.25rem+var(--frenz-safe-top))] z-20 flex items-center gap-2 transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        {/* Author: turn resharing on/off for THIS story. Viewer: reshare it —
            but only when the author allows it (owner, 2026-07-16). The row is
            hidden rather than disabled when it's off: a greyed-out "Reshare"
            would advertise an action that will never work. */}
        {isOwn ? (
          <button
            type="button"
            onClick={() => void toggleAllowReshare()}
            aria-pressed={effectiveAllow}
            title={effectiveAllow ? "Resharing is on — tap to turn off" : "Resharing is off — tap to turn on"}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
          >
            <Repeat2 className={cn("h-4 w-4", !effectiveAllow && "opacity-40")} />
            {effectiveAllow ? "Resharing on" : "Resharing off"}
          </button>
        ) : effectiveAllow ? (
          <button
            type="button"
            onClick={() => setResharing(true)}
            aria-label="Reshare this story"
            className="rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20"
          >
            <Repeat2 className="h-5 w-5" />
          </button>
        ) : null}
        <button type="button" onClick={() => setOptionsOpen(true)} aria-label="Story options" className="rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20">
          <MoreHorizontal className="h-5 w-5" />
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-white/10 p-2 text-white backdrop-blur"><X className="h-5 w-5" /></button>
      </div>

      {story && optionsOpen ? (
        <StoryOptions
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          story={story}
          group={group}
          isOwn={isOwn}
          allowShare={effectiveAllow}
          onSeenBy={() => setViewersOpen(true)}
          onReshare={() => setResharing(true)}
          onDeleted={(id) => {
            const left = group.stories.length - 1;
            const updated = groups.map((g) => (g.userId === group.userId ? { ...g, stories: g.stories.filter((x) => x.id !== id) } : g)).filter((g) => g.stories.length > 0);
            seed<StoryGroup[]>("stories", updated);
            writeCachedStories(updated);
            setPct(0);
            if (left > 0) setSi(Math.min(si, left - 1));
            else if (gi < groups.length - 1) setSi(0); // the next person's stories move into this index
            else {
              onClose();
              return;
            }
            setDeletedIds((prev) => new Set(prev).add(id));
          }}
        />
      ) : null}

      {story ? (
        <ReshareSheet
          open={resharing}
          onClose={() => setResharing(false)}
          source="story"
          sourceId={story.id}
          mediaKind={story.mediaKind}
          previewUrl={story.mediaKind === "image" ? story.mediaUrl : story.thumbnailUrl}
        />
      ) : null}

      {/*
        ── "Seen by" — the author's own story only (2026-10-04) ──────────────
        Bottom-left, where Instagram and Snapchat both put it, so it is where a
        thumb already expects it and it does not compete with the reshare and
        close controls at the top right.

        Rendered only for `isOwn`: the route refuses anyone else and RLS refuses
        them underneath that, but offering a control that will 403 is worse than
        not offering it. Lazy — the sheet fetches nothing until it is opened, so
        an author scrolling their own statuses pays nothing for it.
      */}
      {isOwn && story ? (
        <>
          <button
            type="button"
            onClick={() => setViewersOpen(true)}
            className={cn(
              "absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-[12.5px] font-semibold text-white ring-1 ring-inset ring-white/15 backdrop-blur-md transition hover:bg-white/20 active:scale-95",
              holding && "pointer-events-none opacity-0",
            )}
          >
            <Eye className="h-4 w-4" aria-hidden /> Seen by
          </button>
          <StoryViewersSheet storyId={story.id} open={viewersOpen} onClose={() => setViewersOpen(false)} />
        </>
      ) : null}

      {/*
        Progress segments — right on the safe-area line (owner, 2026-08-11:
        "the progress bar should be in the line of the safe area"), a small
        0.625rem breathing gap rather than the 0.75rem it had, which is what
        the media stage's own top offset below is now measured FROM.
      */}
      <div
        className={cn(
          "absolute inset-x-3 top-[calc(0.625rem+var(--frenz-safe-top))] z-20 flex gap-[3px] transition-opacity duration-150",
          holding && "opacity-0",
        )}
        role="group"
        aria-label={`Story ${si + 1} of ${group.stories.length}`}
      >
        {/*
          ── The segmented bar (owner, 2026-10-04, with a reference) ──────────
          One segment per status, so the COUNT IS THE BAR: "users see their or
          other story progress and how many status they uploaded" needs no
          separate "3 / 7" label, and a label would be one more thing covering
          the picture.

          Premium without weight: 2.5px tall, fully rounded, and a hairline
          shadow so the unfilled track survives a white photo underneath —
          `bg-white/30` alone disappears on a bright frame, which is exactly
          when somebody is trying to read their progress.

          🔴 No backdrop-blur and no gradient here, deliberately. This element
          sits over every frame of a playing video; a backdrop-filter on it is
          the one thing on this screen that would genuinely cost frames, and the
          owner asked for premium "without heavy weight".

          The fill transitions only on segments that are NOT the current one —
          the active segment is driven by a RAF/timeupdate at ~60fps already, and
          a CSS transition on top of that makes it lag behind the video.
        */}
        {group.stories.map((_, idx) => (
          <span
            key={idx}
            className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/30 shadow-[0_0_1px_rgba(0,0,0,0.45)]"
          >
            <span
              className={cn("block h-full rounded-full bg-white", idx !== si && "transition-[width] duration-200")}
              style={{ width: `${idx < si ? 100 : idx === si ? pct : 0}%` }}
            />
          </span>
        ))}
      </div>

      {/*
        ── The author row, rebuilt to the owner's reference (2026-10-04) ──────

        Avatar hard left, the name bold on its own line, and the time UNDER it
        in a lighter weight — the reference's two-line block, not the single
        inline name this had. The second line is what the row gains: a story is
        ephemeral, so "when was this posted" is the one fact a viewer actually
        wants and the old row never answered.

        Sits directly beneath the progress bar (`2.1rem` vs the bar's `0.625rem`)
        so the two read as one piece of chrome rather than two floating
        elements, which is what the reference shows.

        Premium and light: NO glass panel behind it. A blurred pane here would
        be a permanent rectangle over the top of every story, and the text
        already survives any background on the drop-shadow alone — which costs
        nothing to composite.
      */}
      <div
        className={cn(
          "absolute left-3 top-[calc(2.1rem+var(--frenz-safe-top))] z-20 flex min-w-0 items-center gap-2.5 pr-28 text-white transition-opacity duration-150",
          holding && "pointer-events-none opacity-0",
        )}
      >
        {group.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={group.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/35" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold ring-1 ring-white/25">
            {group.displayName.charAt(0)}
          </span>
        )}
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-bold tracking-[-0.01em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
            {group.displayName}
          </span>
          {story ? (
            <span className="block truncate text-[12.5px] font-medium text-white/70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              {formatRelative(story.createdAt)}
            </span>
          ) : null}
        </span>
      </div>

      {/*
        tap zones: left third = back, the rest = forward (full-screen coverage).
        Also the hold surface — press either zone and hold past 220ms to clear
        the screen; release before that and it's an ordinary tap. `onClick`
        checks `wasHold` because a hold's release still fires a click event,
        which must NOT also navigate.
      */}
      <button
        type="button"
        aria-label="Previous"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onClick={() => { if (!wasHold.current) prev(); }}
        className="absolute inset-y-0 left-0 z-10 w-1/3"
      />
      <button
        type="button"
        aria-label="Next"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onClick={() => { if (!wasHold.current) next(); }}
        className="absolute inset-y-0 left-1/3 right-0 z-10"
      />

      {/*
        ── The stage, corrected AGAIN (owner, 2026-08-16) ────────────────────
        "the story top progress bar... needed that progress bar to be on top
        of the video or image, and to the bottom 0, and the top should not
        cross the safe area."

        Reverses the 2026-08-11 pass directly above (kept in git history, not
        repeated here): that version padded the stage below the progress bar
        so the two never occupied the same pixels. The current, more recent
        instruction is the opposite shape — the bar OVERLAYS the media rather
        than the media stopping short of it, which is also how History's
        equivalent stage already worked and was confirmed correct the same
        day ("the history top is perfect already"). Media is `inset-0` again,
        genuinely full-bleed including the region behind the progress bar and
        the status bar; the bar itself keeps its own `safe-top`-aware position
        AND now an explicit `z-20` vs. the stage's explicit `z-0` (was
        implicit `z-auto` before — CSS stacking already put it on top either
        way, but this makes the ordering a fact of the markup, not an
        inference from the spec). "Should not cross the safe area" is about
        the CONTROLS (the bar, the buttons) staying clear of the notch, which
        their own `safe-top`-based offsets already guarantee — it was never
        asking the MEDIA to stop short, which is the one thing an immersive
        full-bleed video viewer specifically should not do.
      */}
      {/*
        ── 🔴 THE MEDIA STOPS AT THE SAFE AREA; THE CHROME FLOATS ON IT ──────
        (owner, 2026-10-04, with a screenshot of the Dynamic Island)

        "The media is supposed to go under the progress bar, the progress bar
        should float on top. But the media should not cross the safe area."

        Those are two separate requirements and the old `inset-0` satisfied
        neither cleanly: the media ran under the notch (crossing the safe area),
        and because it did, the progress bar ended up reading as part of a black
        band above the picture rather than as something lying ON it.

        Now: `top` is the safe inset, so the picture begins exactly at the line
        the status bar ends on and never passes behind it — and the progress bar
        keeps its own `calc(0.625rem + safe-top)` offset, which now places it
        just INSIDE the media's top edge. Same two elements, the relationship
        the owner is asking for.

        The note above is the superseded 2026-08-16 reasoning and is kept
        deliberately: it argued an immersive viewer should never make the media
        stop short, which is true of the BOTTOM (still `0`) and is what the new
        instruction overrides for the top.
      */}
      {/*
        ── 🔴 THE PWA KEEPS A BOTTOM BAND (owner, 2026-10-08: "story upload
        shouldn't go to the bottom below on pwa, the bottom should be comment,
        react and all") ──────────────────────────────────────────────────────
        In the INSTALLED app the media stops above a black band, and the reply
        box and reactions (or, on your own story, Seen by) live in that band —
        Instagram's shape, and the same rule the History viewer follows
        (download-player.tsx). In a browser its own toolbar is the bottom, so the
        media still runs to the edge there.
      */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-0 flex items-center justify-center",
          isOwn
            ? "[.pwa-standalone_&]:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]"
            : "[.pwa-standalone_&]:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.75rem)]",
        )}
        style={{ top: "var(--frenz-safe-top, 0px)" }}
      >
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
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setPct((v.currentTime / v.duration) * 100);
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
      {story.caption ? (
        <p
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-28 z-[15] px-6 text-center text-sm text-white/95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] transition-opacity duration-150",
            // in the PWA the caption sits on the media, just above the band
            isOwn ? "[.pwa-standalone_&]:bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]" : "[.pwa-standalone_&]:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+6.75rem)]",
            holding && "opacity-0",
          )}
        >
          {story.caption}
        </p>
      ) : null}

      {/* Reply bar — text, emojis & stickers (delivered as a DM). Hidden with
          the rest of the chrome while holding, not just faded: it sits UNDER
          a `pointer-events-none` toggle of its own composer input, and a
          held thumb resting near the bottom of the screen must not land on a
          text field it can no longer see. */}
      {isOwn || holding ? null : (
        <StoryReplyBar toUserId={group.userId} name={group.displayName.split(" ")[0] || group.displayName} onFocusChange={setReplying} />
      )}
    </motion.div>
  );
}

function StoryReplyBar({ toUserId, name, onFocusChange }: { toUserId: string; name: string; onFocusChange: (v: boolean) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stickers, setStickers] = useState(false);

  const send = async (payload: string) => {
    const t = payload.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    setStickers(false);
    try {
      const r = await fetch("/api/stories/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, text: t }),
      });
      if (r.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 1600);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/70 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5 [.pwa-standalone_&]:bg-black [.pwa-standalone_&]:bg-none [.pwa-standalone_&]:pt-3">
      {sent ? (
        <p className="mb-2 text-center text-xs font-semibold text-emerald-300">Sent to {name} ✓</p>
      ) : (
        <div className="mb-2 flex justify-center gap-2">
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => send(e)} className="text-2xl transition active:scale-125" aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      {stickers ? (
        <div className="mx-auto mb-2 grid max-w-md grid-cols-6 gap-1 rounded-2xl bg-white/10 p-2 backdrop-blur">
          {STICKERS.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-xl py-1.5 text-2xl transition hover:bg-white/10 active:scale-110" aria-label={`Sticker ${s}`}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mx-auto flex max-w-md items-center gap-2">
        <button
          type="button"
          onClick={() => setStickers((v) => !v)}
          aria-label="Stickers"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        >
          <Smile className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(text);
          }}
          maxLength={500}
          placeholder={`Reply to ${name}…`}
          className="h-10 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white outline-none backdrop-blur placeholder:text-white/50 focus:border-white/40"
        />
        <button
          type="button"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-label="Send reply"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white transition disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
