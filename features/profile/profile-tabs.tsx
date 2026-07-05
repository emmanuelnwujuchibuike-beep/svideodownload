"use client";

import { Bookmark, Clapperboard, Download, Grid3x3, Heart, LayoutGrid, Repeat2, Rows3 } from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";

import { DownloadsTab } from "@/features/profile/downloads-tab";
import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

export type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved";
type MediaView = "grid" | "list";
const VIEW_COOKIE = "svd_profile_view";

type IconType = ComponentType<{ className?: string }>;

const TAB_LABEL: Record<ProfileTab, string> = {
  posts: "Posts",
  reels: "Reels",
  downloads: "Downloads",
  reposted: "Reposts",
  liked: "Liked",
  saved: "Saved",
};

const TAB_ICON: Record<ProfileTab, IconType> = {
  posts: Grid3x3,
  reels: Clapperboard,
  downloads: Download,
  reposted: Repeat2,
  liked: Heart,
  saved: Bookmark,
};

/**
 * Instant, client-side profile tabs. All datasets are handed in from the server
 * once, so switching between Posts / Reels / Downloads / Reposts / Liked / Saved
 * is immediate on every device — no navigation, no skeleton, never a reload.
 * The tab bar is a clean icon+underline rail (no sideways slide); the grid/list
 * view toggle lives on the far right, always separated from the tabs.
 * `initialView` is seeded from a cookie so the chosen layout paints instantly.
 */
export function ProfileTabs({
  handle,
  isOwner,
  tabs,
  initialTab,
  initialView = "grid",
  posts,
  liked,
  saved,
  reposted = [],
}: {
  handle: string;
  isOwner: boolean;
  tabs: ProfileTab[];
  initialTab: ProfileTab;
  initialView?: MediaView;
  posts: PostCard[];
  liked: PostCard[];
  saved: PostCard[];
  reposted?: PostCard[];
}) {
  const [active, setActive] = useState<ProfileTab>(tabs.includes(initialTab) ? initialTab : "posts");
  // Grid vs X-style list — seeded from a cookie (instant, no flash), remembered on-device.
  const [view, setView] = useState<MediaView>(initialView);
  const chooseView = (v: MediaView) => {
    setView(v);
    try {
      document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
  };

  const reels = useMemo(() => posts.filter((p) => p.mediaKind === "video"), [posts]);
  const publishedDownloads = useMemo(() => posts.filter((p) => p.platform && p.platform !== "frenz"), [posts]);

  const select = (id: ProfileTab) => {
    setActive(id);
    // Reflect the tab in the URL for shareability — WITHOUT a navigation/reload.
    if (typeof window !== "undefined") {
      const url = id === "posts" ? `/u/${handle}` : `/u/${handle}?tab=${id}`;
      window.history.replaceState(window.history.state, "", url);
    }
  };

  const empty: Record<ProfileTab, string> = {
    posts: isOwner ? "You haven't posted anything yet — tap + to create." : "No public posts yet.",
    reels: "No reels yet.",
    downloads: isOwner
      ? "Videos you download will appear here — even ones you grabbed before signing up."
      : "No published downloads yet.",
    reposted: isOwner ? "Posts you repost will show up here." : "No reposts yet.",
    liked: "Posts you like will show up here.",
    saved: "Posts you save will show up here.",
  };

  const showViewToggle = active !== "downloads";

  return (
    <div className="mt-8">
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-border/60">
        {/* Tabs — icon rail with a gradient underline. No sideways slide. */}
        <div className="flex items-center">
          {tabs.map((id) => {
            const Icon = TAB_ICON[id];
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-pressed={isActive}
                title={TAB_LABEL[id]}
                className={cn(
                  "group relative flex items-center gap-2 px-2.5 py-3 text-sm font-semibold transition-colors sm:px-3.5",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-[19px] w-[19px] shrink-0 transition-transform group-active:scale-90" />
                <span className="hidden sm:inline">{TAB_LABEL[id]}</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-1.5 -bottom-px h-[3px] rounded-full bg-gradient-to-r from-blue-600 to-violet-600 shadow-[0_0_10px] shadow-violet-500/40"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Grid ⇄ list view toggle — always on the right, never touching the tabs */}
        {showViewToggle ? (
          <div className="mb-2 flex shrink-0 items-center gap-0.5 rounded-xl border border-border/60 bg-card/70 p-0.5 shadow-sm backdrop-blur">
            {(
              [
                { v: "grid" as const, Icon: LayoutGrid, label: "Grid view" },
                { v: "list" as const, Icon: Rows3, label: "List view" },
              ]
            ).map(({ v, Icon, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => chooseView(v)}
                aria-label={label}
                aria-pressed={view === v}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition active:scale-95",
                  view === v ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-[17px] w-[17px]" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Keep it a single mounted content region that swaps instantly */}
      {active === "downloads" && isOwner ? (
        <DownloadsTab emptyText={empty.downloads} />
      ) : (
        <ProfileMediaGrid
          posts={
            active === "reels"
              ? reels
              : active === "downloads"
                ? publishedDownloads
                : active === "liked"
                  ? liked
                  : active === "saved"
                    ? saved
                    : active === "reposted"
                      ? reposted
                      : posts
          }
          layout={active === "reels" ? "reel" : "card"}
          view={view}
          emptyText={empty[active]}
        />
      )}
    </div>
  );
}
