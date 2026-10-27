"use client";

import { Plus, CircleDashed } from "lucide-react";
import { useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { AddStoryLink } from "@/features/app-shell/dashboard/add-story-link";
import { preloadStoryViewer, StoryViewer, useWarmStoryViewer } from "@/features/app-shell/dashboard/stories-row";
import { useQuery } from "@/features/data";
import type { StoryGroup } from "@/lib/social/stories";
import { useStoryDeepLink } from "@/features/app-shell/dashboard/use-story-deep-link";
import { isGroupSeen, useSeenOverlay } from "@/lib/social/story-seen";
import { cn } from "@/lib/utils";

type Scope = "friends" | "following";

async function loadScope(scope: Scope): Promise<StoryGroup[]> {
  const r = await fetch(`/api/stories?scope=${scope}`);
  if (!r.ok) return [];
  const d = (await r.json()) as { groups: StoryGroup[] };
  return d.groups ?? [];
}

/**
 * Friends-page stories: a horizontal ring row with a Friends / Following toggle.
 * Friends = stories from people you're friends with; Following = stories from
 * creators you follow. Both are cached-first (seeded from the server) so the row
 * paints instantly and swapping tabs is free after the first load. Reuses the
 * shared StoryViewer so playback matches the rest of the app.
 */
export function FriendsStories({
  initialFriends,
  initialFollowing,
  viewerAvatarUrl,
  viewerName,
  viewerHandle,
}: {
  initialFriends?: StoryGroup[];
  initialFollowing?: StoryGroup[];
  viewerAvatarUrl?: string | null;
  viewerName?: string;
  viewerHandle?: string | null;
}) {
  const [scope, setScope] = useState<Scope>("friends");

  const friends = useQuery<StoryGroup[]>("stories:friends", () => loadScope("friends"), { initialData: initialFriends });
  const following = useQuery<StoryGroup[]>("stories:following", () => loadScope("following"), {
    initialData: initialFollowing,
  });

  const groups = (scope === "friends" ? friends.data : following.data) ?? [];
  const otherGroups = viewerHandle ? groups.filter((g) => g.handle !== viewerHandle) : groups;
  const [start, setStart] = useState<number | null>(null);
  const [startStory, setStartStory] = useState<string | undefined>(undefined);
  const initial = (viewerName ?? "").charAt(0).toUpperCase() || "+";
  // Back from a Frenz Coin gift opened inside a story returns here with ?story=<id> (2026-10-26)
  useStoryDeepLink(scope === "friends" ? friends.data : following.data, (gi, id) => {
    setStartStory(id);
    setStart(gi);
  });

  // the server's per-story `seen` plus this session's confirmed views (Stories Part 3, lib/social/story-seen.ts)
  const seen = useSeenOverlay();
  // Part 5: the viewer's code is ready before the first tap (after load, never during it)
  useWarmStoryViewer(otherGroups.length > 0);

  return (
    <div className="mb-5">
      {/*
        Friends / Following selector.

        The active pill is one absolutely-positioned element translated between
        the halves rather than two buttons swapping colours, so switching reads
        as the control responding. `transform` only — no width animation and
        nothing that triggers layout. Same language as /explore's sort control,
        so the two surfaces feel like one product.

        A neutral white pill on a soft fill (design/friends, 2026-10-26), not a
        purple one: this sits directly above the story ring and the brand
        gradient already lives there.
      */}
      <div
        role="tablist"
        aria-label="Stories"
        className="relative mb-3 inline-flex rounded-[14px] bg-frenz-fill p-[3px] text-[13px]"
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[11px] bg-frenz-card shadow-[0_2px_8px_-2px_rgb(30_20_80/0.18)]",
            "transition-transform duration-250 ease-[var(--ease-out)] motion-reduce:transition-none",
          )}
          style={{ transform: scope === "following" ? "translateX(100%)" : "translateX(0)" }}
        />
        {(["friends", "following"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            onClick={() => setScope(s)}
            aria-selected={scope === s}
            className={cn(
              // 36px tall with the padding — a comfortable target without the
              // control growing into the story row below it.
              "relative z-10 h-[34px] min-w-[92px] rounded-[11px] px-3.5 capitalize",
              "transition-colors duration-200 motion-reduce:transition-none",
              scope === s ? "font-extrabold text-frenz-ink" : "font-semibold text-frenz-muted",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Add your story — the dedicated Story surface (owner, 2026-07-16). */}
        <PressIcon className="shrink-0">
          <AddStoryLink label="Add to your story" className="flex w-[68px] flex-col items-center gap-1.5">
            <span className="relative flex h-16 w-16 rounded-full border-2 border-dashed border-frenz-violet/30 p-[3px]">
              {viewerAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewerAvatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="flex flex-1 items-center justify-center rounded-full bg-frenz-gradient font-heading text-[20px] font-extrabold text-white">
                  {initial}
                </span>
              )}
              <span className="absolute -bottom-[3px] -right-[3px] flex h-6 w-6 items-center justify-center rounded-full border-[2.5px] border-frenz-page bg-frenz-ink text-frenz-page">
                <Plus className="h-[11px] w-[11px]" strokeWidth={3.4} />
              </span>
            </span>
            <span className="text-[12px] font-bold text-frenz-ink">Your story</span>
          </AddStoryLink>
        </PressIcon>

        {otherGroups.map((g) => {
          const cover = g.stories[0];
          const unseen = !isGroupSeen(g, seen);
          return (
            <PressIcon key={g.handle} className="shrink-0">
              <button type="button" onPointerDown={preloadStoryViewer} onClick={() => setStart(groups.indexOf(g))} className="flex w-16 flex-col items-center gap-1.5">
                <span className={cn("rounded-full p-0.5", unseen ? "bg-brand" : "ring-1 ring-inset ring-border/70")}>
                  <span className="block overflow-hidden rounded-full bg-background p-0.5">
                    {cover?.mediaKind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.mediaUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                    ) : cover?.mediaKind === "video" && cover.thumbnailUrl ? (
                      /*
                        🔴 Never a <video> for a 54 px circle (2026-10-06): `#t=0.3` with
                        preload="metadata" pulls most of an MP4 whose index sits at the
                        end. The story's own thumbnail, else the avatar below.
                      */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.thumbnailUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                    ) : g.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.avatarUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                    ) : (
                      <span className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white">
                        {g.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                </span>
                <span className={cn("w-16 truncate text-center text-[11px]", unseen ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
                  {g.displayName.split(" ")[0]}
                </span>
              </button>
            </PressIcon>
          );
        })}

        {otherGroups.length === 0 ? (
          /*
            The empty state, sized to the story ring beside it rather than to
            the page — a dashed neutral panel that says "stories land here",
            occupying only the row it belongs to. Deliberately no illustration
            and no extra copy: the existing sentence is the whole message, and
            the brief rules out growing it.
          */
          <div className="flex h-16 min-w-0 flex-1 items-center gap-2.5 rounded-[20px] bg-frenz-fill/70 px-3.5">
            <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-frenz-card text-frenz-violet">
              <CircleDashed className="h-[17px] w-[17px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-[14px] font-bold text-frenz-ink">{scope === "friends" ? "No friend stories yet" : "No stories yet"}</span>
              <span className="truncate text-[12px] text-frenz-muted">
                {scope === "friends" ? "Add friends to see theirs here" : "Stories from people you follow land here"}
              </span>
            </span>
          </div>
        ) : null}
      </div>

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
