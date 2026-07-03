"use client";

import { useMemo, useState } from "react";

import { DownloadsTab } from "@/features/profile/downloads-tab";
import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import type { PostCard } from "@/lib/social/posts";

export type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved";

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

  return (
    <div className="mt-8">
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto border-b border-border/60 px-4 pb-3 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          emptyText={empty[active]}
        />
      )}
    </div>
  );
}
