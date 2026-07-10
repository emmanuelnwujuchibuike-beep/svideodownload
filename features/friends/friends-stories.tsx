"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { StoryViewer } from "@/features/app-shell/dashboard/stories-row";
import { openUpload } from "@/features/create/upload-store";
import { useQuery } from "@/features/data";
import type { StoryGroup } from "@/lib/social/stories";
import { isGroupSeen, loadSeenMap, type SeenMap } from "@/lib/social/story-seen";
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
  const initial = (viewerName ?? "").charAt(0).toUpperCase() || "+";

  const [seen, setSeen] = useState<SeenMap>({});
  useEffect(() => setSeen(loadSeenMap()), [groups]);

  return (
    <div className="mb-5">
      {/* Friends / Following segmented toggle */}
      <div className="mb-3 inline-flex rounded-full border border-border/60 bg-card/60 p-0.5 text-xs font-semibold">
        {(["friends", "following"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={cn(
              "rounded-full px-4 py-1.5 capitalize transition",
              scope === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s} stories
          </button>
        ))}
      </div>

      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Add your story */}
        <PressIcon className="shrink-0">
          <button type="button" onClick={() => openUpload("story")} className="flex w-16 flex-col items-center gap-1.5">
            <span className="relative rounded-full p-0.5 ring-1 ring-inset ring-border/70">
              <span className="block rounded-full bg-background p-0.5">
                {viewerAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={viewerAvatarUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                ) : (
                  <span className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white">
                    {initial}
                  </span>
                )}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-background">
                <Plus className="h-3.5 w-3.5" />
              </span>
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">Your Story</span>
          </button>
        </PressIcon>

        {otherGroups.map((g) => {
          const cover = g.stories[0];
          const unseen = !isGroupSeen(g, seen);
          return (
            <PressIcon key={g.handle} className="shrink-0">
              <button type="button" onClick={() => setStart(groups.indexOf(g))} className="flex w-16 flex-col items-center gap-1.5">
                <span className={cn("rounded-full p-0.5", unseen ? "bg-brand" : "ring-1 ring-inset ring-border/70")}>
                  <span className="block overflow-hidden rounded-full bg-background p-0.5">
                    {cover?.mediaKind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.mediaUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                    ) : cover?.mediaKind === "video" ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={`${cover.mediaUrl}#t=0.3`} muted playsInline preload="metadata" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
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
          <div className="flex flex-1 items-center px-2 text-xs text-muted-foreground">
            {scope === "friends" ? "No friend stories right now." : "No stories from people you follow yet."}
          </div>
        ) : null}
      </div>

      {start !== null ? (
        <StoryViewer groups={groups} startGroup={start} onClose={() => setStart(null)} onGroupSeen={() => setSeen(loadSeenMap())} />
      ) : null}
    </div>
  );
}
