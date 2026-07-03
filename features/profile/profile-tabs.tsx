"use client";

import { LayoutGrid, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DownloadsTab } from "@/features/profile/downloads-tab";
import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

export type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved";
type MediaView = "grid" | "list";
const VIEW_KEY = "svd:profileView";

const TAB_LABEL: Record<ProfileTab, string> = {
  posts: "Posts",
  reels: "Reels",
  downloads: "Downloads",
  reposted: "Reposts",
  liked: "Liked",
  saved: "Saved",
};

/**
 * Instant, client-side profile tabs. All datasets are handed in from the server
 * once, so switching between Posts / Reels / Downloads / Reposts / Liked / Saved
 * is immediate on every device — no navigation, no skeleton, never a reload.
 * The Downloads tab (owner) shows the on-device download history.
 */
export function ProfileTabs({
  handle,
  isOwner,
  tabs,
  initialTab,
  posts,
  liked,
  saved,
}: {
  handle: string;
  isOwner: boolean;
  tabs: ProfileTab[];
  initialTab: ProfileTab;
  posts: PostCard[];
  liked: PostCard[];
  saved: PostCard[];
}) {
  const [active, setActive] = useState<ProfileTab>(tabs.includes(initialTab) ? initialTab : "posts");
  // Grid vs X-style list — remembered on-device so it stays how you left it.
  const [view, setView] = useState<MediaView>("grid");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseView = (v: MediaView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
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
    reposted: "Reposts are coming soon.",
    liked: "Posts you like will show up here.",
    saved: "Posts you save will show up here.",
  };

  const showViewToggle = active !== "downloads";

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2 border-b border-border/60 pb-3">
        <div className="-mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-pressed={active === id}
              className={
                active === id
                  ? "shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25"
                  : "shrink-0 rounded-full border border-border/70 bg-card/60 px-5 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              }
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>

        {/* Grid ⇄ list view toggle */}
        {showViewToggle ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/60 bg-card/60 p-0.5">
            {([
              { v: "grid" as const, Icon: LayoutGrid, label: "Grid view" },
              { v: "list" as const, Icon: Rows3, label: "List view" },
            ]).map(({ v, Icon, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => chooseView(v)}
                aria-label={label}
                aria-pressed={view === v}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition",
                  view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
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
                      ? []
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
