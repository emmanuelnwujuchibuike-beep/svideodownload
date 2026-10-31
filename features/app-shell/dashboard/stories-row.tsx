"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { seed, useQuery } from "@/features/data";
import { fetchStoryGroups, readCachedStories } from "@/lib/social/story-cache";
import type { StoryGroup } from "@/lib/social/stories";
import { isGroupSeen, useSeenOverlay } from "@/lib/social/story-seen";

import { afterPageLoad } from "@/features/app-shell/warm-routes";
import { isSlowConnection } from "@/lib/pwa/use-network-status";

import { AddStoryLink } from "./add-story-link";
import { useStoryDeepLink } from "./use-story-deep-link";
import { cn } from "@/lib/utils";

/*
  Ring sizes. `compact` is the Messages inbox (2026-10-09 reference: "smaller
  stories section — reduced height, compact avatar, more space for chats"):
  60px avatars in 72px columns instead of 68 / 82. /home keeps the full size.
*/
// /home: the design's 64 px ring (design/Feed.dc.html, 2026-10-18) — a 54 px face inside a 2.5 px ring and gap.
const AV = "h-[54px] w-[54px]";
const AV_COMPACT = "h-[3.75rem] w-[3.75rem]";
const COL = "w-16";
const COL_COMPACT = "w-[4.5rem]";

/*
  The full-screen viewer — framer-motion, the ad card, the reply bar, the reshare / viewers / options sheets — lives in
  ./story-viewer.tsx and is fetched the first time someone opens a story (Stories Part 2, 2026-10-26: the audit found
  it shipped with the rings on every /home and /messages entry, though most visits never open one). Exported here
  under the same name, so Friends and a chat thread, which import it from this module, are lazy too.
*/
export const StoryViewer = dynamic(() => import("./story-viewer").then((m) => m.StoryViewer), { ssr: false });
// the same module as the viewer above — the loader fetches it once, whoever asks first
const loadViewer = () => import("./story-viewer");

/*
  Stories Part 5 (2026-10-27) — "loading the viewer on first tap" (the Part 1 plan): the viewer's code started
  downloading only at the first tap, so the first story opened after a wait. It is now fetched (once — the module
  loader keeps it) the moment a finger lands on a ring, and on its own once the page has LOADED and gone idle
  (afterPageLoad; never during a cold entry, never on a slow or data-saver connection). Still not in the page bundle.
*/
let viewerWarm: Promise<unknown> | null = null;
export function preloadStoryViewer(): void {
  viewerWarm ??= loadViewer().catch(() => {
    viewerWarm = null; // a failed fetch is retried by the next warm, or by the tap itself
  });
}
/** Warm the viewer after load, for a page that shows story rings. */
export function useWarmStoryViewer(active: boolean): void {
  useEffect(() => {
    if (!active || isSlowConnection()) return;
    return afterPageLoad(preloadStoryViewer);
  }, [active]);
}

/**
 * One story circle. Shared by the viewer's own row and the friends row so the
 * two can never drift apart visually.
 */
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
      <button type="button" onPointerDown={preloadStoryViewer} onClick={onOpen} className={cn("flex flex-col items-center", col, compact ? "gap-1" : "gap-1.5")}>
        {/* unseen: the brand-gradient ring (identity — allowed); seen: the hairline */}
        <span className={cn("rounded-full p-[2.5px]", unseen ? "bg-frenz-gradient" : "ring-1 ring-inset ring-frenz-line")}>
          <span className="block overflow-hidden rounded-full bg-frenz-page p-[2.5px]">
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
                // same-frame decode: a ring already downloaded paints WITH the page on a return, never a blank frame first (owner, 2026-10-31)
                decoding="sync"
                className={cn(av, "rounded-full bg-secondary object-cover")}
              />
            ) : group.avatarUrl ? (
              <Image src={group.avatarUrl} alt="" width={68} height={68} decoding="sync" className={cn(av, "rounded-full bg-secondary object-cover")} />
            ) : (
              <span className={cn(av, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white")}>
                {group.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </span>
        <span className={cn(col, "truncate text-center text-xs", unseen ? "font-semibold text-frenz-ink" : "font-medium text-frenz-muted")}>
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
  const [startStory, setStartStory] = useState<string | undefined>(undefined);
  const initial = (viewerName ?? "").charAt(0).toUpperCase() || "+";

  // `?story=<id>` opens that one story — a "Frenz Coin for your story" notification, or Back from the coin transfer
  useStoryDeepLink(data, (gi, id) => {
    setStartStory(id);
    setStart(gi);
  });

  // Server groups sort the viewer's own stories first when present — surfaced
  // once as a dedicated "Your Story" card, not a second time in the row below.
  const ownGroup = viewerHandle ? groups.find((g) => g.handle === viewerHandle) : undefined;
  const otherGroups = ownGroup ? groups.filter((g) => g !== ownGroup) : groups;

  // Seen/unseen rings (Stories Part 3): each story's server `seen` — so the
  // server-rendered row already paints the right colour, on every device — plus
  // the views this session has had confirmed (empty on the server, so hydration
  // matches; a confirmed view re-renders the ring with no refetch).
  const seen = useSeenOverlay();
  // Part 5: the viewer's code is ready before the first tap (after load, never during it)
  useWarmStoryViewer(groups.length > 0);

  return (
    <div className={cn("frenz-ui -mx-1 flex overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", compact ? "gap-2.5" : "gap-3.5")}>
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
        <AddStoryLink label="Add to your story" className={cn("flex flex-col items-center", compact ? cn(COL_COMPACT, "gap-1") : cn(COL, "gap-1.5"))}>
          {/* the design's "Your story": a dashed ring, the gradient plus badge */}
          <span className="relative rounded-full border-2 border-dashed border-frenz-violet/30 p-[1.5px]">
            <span className="block rounded-full bg-frenz-page p-[1.5px]">
              {viewerAvatarUrl ? (
                <Image src={viewerAvatarUrl} alt="" width={68} height={68} decoding="sync" className={cn(av, "rounded-full object-cover")} />
              ) : (
                <span className={cn(av, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white")}>
                  {initial}
                </span>
              )}
            </span>
            <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-frenz-gradient-x text-white ring-2 ring-frenz-page", compact ? "h-6 w-6" : "h-[22px] w-[22px]")}>
              <Plus className={compact ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={3.2} />
            </span>
          </span>
          {/* "Your story" as designed until you have one — then your ring carries that name and this is "Add story" */}
          <span className="text-xs font-semibold text-frenz-ink/80">{ownGroup ? "Add story" : "Your story"}</span>
        </AddStoryLink>
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
        <StoryViewer
          groups={groups}
          startGroup={start}
          startStoryId={startStory}
          onClose={() => {
            setStart(null);
            setStartStory(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
