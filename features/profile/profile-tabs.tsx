"use client";

import {
  Award,
  BadgeCheck,
  Bookmark,
  BookOpen,
  Briefcase,
  Clapperboard,
  Clock,
  Download,
  FileText,
  FolderHeart,
  GraduationCap,
  Grid3x3,
  IdCard,
  LayoutGrid,
  Package,
  Repeat2,
  Rows3,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ComponentType, type ReactNode, useMemo, useState } from "react";

import { WowOutline } from "@/components/brand/wow-icon";

import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";

// These tabs render only when selected, so defer their chunks off first load.
const CollectionsTab = dynamic(() => import("@/features/profile/collections-tab").then((m) => m.CollectionsTab), { ssr: false });
const DownloadsTab = dynamic(() => import("@/features/profile/downloads-tab").then((m) => m.DownloadsTab), { ssr: false });

/** The post-backed sections this component renders from its own datasets. */
export type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved" | "collections";

const POST_TABS = new Set<string>(["posts", "reels", "downloads", "reposted", "liked", "saved", "collections"]);

type MediaView = "grid" | "list";
const VIEW_COOKIE = "svd_profile_view";

type IconType = ComponentType<{ className?: string }>;

/** Module icon names (`lib/profile/modules.ts`) → real components. */
const ICONS: Record<string, IconType> = {
  Grid3x3,
  Clapperboard,
  Download,
  FolderHeart,
  Repeat2,
  Heart: WowOutline,
  Bookmark,
  IdCard,
  Trophy,
  LayoutGrid,
  Briefcase,
  GraduationCap,
  BadgeCheck,
  Award,
  BookOpen,
  Sparkles,
  FileText,
  Package,
  Wrench,
  Clock,
};

/** One entry in the dock — resolved by the Universal Profile Engine. */
export interface ProfileSection {
  key: string;
  label: string;
  /** Icon NAME from the module registry (this file owns the mapping). */
  icon: string;
}

/**
 * Smart Navigation Dock™ — now driven by the Universal Profile Engine
 * (Feature 18 · Part 14).
 *
 * The dock used to render a hard-coded tab list. It now renders whatever
 * sections the engine resolved for THIS profile and THIS viewer, in the
 * member's own order — so a Business profile leads with About and Products
 * while a personal one still leads with Posts, from the same component.
 *
 * Post-backed sections keep rendering from the datasets handed in once by the
 * server. Every other section arrives already rendered in `panels`, as a server
 * component passed through as a prop: switching stays instant, nothing is
 * fetched on tap, and none of those panels cost anything in the client bundle.
 */
export function ProfileTabs({
  handle,
  ownerId,
  isOwner,
  sections,
  initialTab,
  initialView = "grid",
  posts,
  liked,
  saved,
  reposted = [],
  panels,
}: {
  handle: string;
  ownerId: string;
  isOwner: boolean;
  sections: ProfileSection[];
  initialTab: string;
  initialView?: MediaView;
  posts: PostCard[];
  liked: PostCard[];
  saved: PostCard[];
  reposted?: PostCard[];
  /** Server-rendered content for every non-post section. */
  panels?: Record<string, ReactNode>;
}) {
  const keys = useMemo(() => sections.map((s) => s.key), [sections]);
  const [active, setActive] = useState<string>(() => (keys.includes(initialTab) ? initialTab : (keys[0] ?? "posts")));

  // Grid vs list — seeded from a cookie (instant, no flash), remembered on-device.
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

  const select = (id: string) => {
    setActive(id);
    // Reflect the section in the URL for shareability — WITHOUT a navigation.
    if (typeof window !== "undefined") {
      const url = id === (keys[0] ?? "posts") ? `/u/${handle}` : `/u/${handle}?tab=${id}`;
      window.history.replaceState(window.history.state, "", url);
    }
  };

  const empty: Record<string, string> = {
    posts: isOwner ? "You haven't posted anything yet — tap + to create." : "No public posts yet.",
    reels: "No reels yet.",
    downloads: isOwner
      ? "Videos you download will appear here — even ones you grabbed before signing up."
      : "No published downloads yet.",
    reposted: isOwner ? "Posts you repost will show up here." : "No reposts yet.",
    liked: "Posts you Wow will show up here.",
    saved: "Posts you save will show up here.",
    collections: isOwner ? "Save posts into collections to organize them." : "No collections yet.",
  };

  // The view toggle belongs to the media grid, so it only appears for the
  // sections that ARE a media grid.
  const showViewToggle = POST_TABS.has(active) && active !== "downloads" && active !== "collections";

  const renderActive = () => {
    if (!POST_TABS.has(active)) return panels?.[active] ?? null;
    if (active === "downloads" && isOwner) return <DownloadsTab emptyText={empty.downloads!} />;
    if (active === "collections") return <CollectionsTab ownerId={ownerId} isOwner={isOwner} emptyText={empty.collections!} />;
    return (
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
        emptyText={empty[active] ?? "Nothing here yet."}
      />
    );
  };

  return (
    <div className="mt-8">
      <div className="mb-6 flex items-center gap-2">
        {/* A premium glass segmented control: the active section lifts into a
            brand pill while the rest stay calm icons (labelled on wider screens,
            icon-only on mobile so every section fits). */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card/60 p-1 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => {
            const Icon = ICONS[s.icon] ?? Grid3x3;
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => select(s.key)}
                aria-pressed={isActive}
                title={s.label}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
                  isActive
                    ? "bg-brand-tile text-white shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 transition-transform group-active:scale-90" />
                <span className={isActive ? "inline" : "hidden sm:inline"}>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Grid ⇄ list view toggle — always separated from the dock */}
        {showViewToggle ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-border/60 bg-card/70 p-0.5 shadow-sm backdrop-blur">
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
                  view === v ? "bg-brand-tile text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-[17px] w-[17px]" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* A single mounted content region that swaps instantly */}
      {renderActive()}
    </div>
  );
}
