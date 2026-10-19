"use client";

import { LayoutGrid, Lock } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { ListViewIcon } from "@/features/frenz-ui/icons";
import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import { loadSubPosts } from "@/features/sub/sub-posts-cache";
import { useStickyState } from "@/features/ui/use-sticky-state";
import type { PostCard } from "@/lib/social/posts";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

// These tabs render only when selected, so defer their chunks off first load.
const CollectionsTab = dynamic(() => import("@/features/profile/collections-tab").then((m) => m.CollectionsTab), { ssr: false });
const DownloadsTab = dynamic(() => import("@/features/profile/downloads-tab").then((m) => m.DownloadsTab), { ssr: false });
const SubPromoCard = dynamic(() => import("@/features/sub/sub-promo-card").then((m) => m.SubPromoCard), { ssr: false });
const SubTab = dynamic(() => import("@/features/sub/sub-tab").then((m) => m.SubTab), { ssr: false });

/** The subscriber-only tab's key (in the URL as ?tab=sub). */
export const SUB_TAB_KEY = "sub";

/** What the server resolved for the SUB POSTS tab: a quote for visitors, settings for the creator. */
export interface SubTabData {
  creatorName: string;
  signedIn: boolean;
  quote: { priceCents: number; feeCents: number; totalCents: number; feePercent: number; periodDays: number } | null;
  settings: { priceCents: number | null; active: boolean; setupStep: number; setupCompleted: boolean; promoDismissed?: boolean; notifySubscribed?: "off" | "push" | "email" | "both" } | null;
  bounds: { minPriceCents: number; maxPriceCents: number; purchaseFeePercent: number; withdrawalFeePercent: number };
}

/** The post-backed sections this component renders from its own datasets. */
export type ProfileTab = "posts" | "reels" | "downloads" | "reposted" | "liked" | "saved" | "collections";

const POST_TABS = new Set<string>(["posts", "reels", "downloads", "reposted", "liked", "saved", "collections"]);

type MediaView = "grid" | "list";
const VIEW_COOKIE = "svd_profile_view";


/** Module icon names (`lib/profile/modules.ts`) → real components. */

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
  sub = null,
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
  sub?: SubTabData | null;
}) {
  const keys = useMemo(() => sections.map((s) => s.key), [sections]);
  const [active, setActive] = useState<string>(() => (keys.includes(initialTab) || (initialTab === SUB_TAB_KEY && !!sub) ? initialTab : (keys[0] ?? "posts")));

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

  // owner 2026-10-11: the "Get paid" card above the tray flips to the subscribe link the moment setup goes live.
  // Sticky: the router cache replays the pre-tap payload on re-entry, which brought a closed card back.
  const [subLive, setSubLive] = useStickyState(`sub-live-${handle}`, Number(!!sub?.settings?.setupCompleted), !!sub?.settings?.setupCompleted);
  const [promoClosed, setPromoClosed] = useStickyState(`sub-promo-${handle}`, Number(!!sub?.settings?.promoDismissed), !!sub?.settings?.promoDismissed);
  const tray = useRef<HTMLDivElement>(null);
  const select = (id: string) => {
    setActive(id);
    // Reflect the section in the URL for shareability — WITHOUT a navigation.
    if (typeof window !== "undefined") {
      const url = id === (keys[0] ?? "posts") ? `${profilePath(handle)}` : `${profilePath(handle)}?tab=${id}`;
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
    if (active === SUB_TAB_KEY && sub) return <SubTab onLiveChange={setSubLive} creatorId={ownerId} creatorName={sub.creatorName} handle={handle} isOwner={isOwner} signedIn={sub.signedIn} quote={sub.quote} settings={sub.settings} bounds={sub.bounds} />;
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
    <div className="mt-6">
      {isOwner && sub?.settings && !promoClosed ? (
        <SubPromoCard
          handle={handle}
          live={subLive}
          onClose={() => {
            // closes on the tap; remembered on the account (0231), put back if the save is refused
            setPromoClosed(true);
            void fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "settings", dismissPromo: true }) }).then((r) => (r.ok ? null : setPromoClosed(false))).catch(() => setPromoClosed(false));
          }}
          onOpen={() => {
            select(SUB_TAB_KEY);
            tray.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      ) : null}
      {/*
        The design's section row (design/Profile.dc.html, 2026-10-18): labelled tabs on the white
        page with the gradient underline under the chosen one (an active indicator — allowed), a
        hairline under the row, and ONE grid / list button at its end. It replaces the glass tray
        (2026-10-16). Every section still swaps in place, and Exclusive still starts loading its
        posts the moment a finger lands. The Exclusive FEED is the Feed's own Exclusive tab now.
      */}
      <nav ref={tray} aria-label="Profile sections" className="frenz-ui relative -mx-4 mb-3 flex scroll-mt-24 items-center border-b border-frenz-line px-2 sm:-mx-6">
        {/* sideways only (owner, 2026-10-19: the row moved up and down) — nothing overflows vertically, and touch pans x only */}
        <div className="flex min-w-0 flex-1 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => {
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => select(s.key)}
                // SUB POSTS: start loading the moment a finger lands, so the gallery opens already filled
                onPointerDown={s.key === SUB_TAB_KEY ? () => void loadSubPosts(ownerId).catch(() => {}) : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-12 shrink-0 items-center gap-1 px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-frenz-violet",
                  isActive ? "font-bold text-frenz-ink" : "font-semibold text-frenz-muted hover:text-frenz-ink",
                )}
              >
                {s.key === SUB_TAB_KEY ? <Lock className="h-[13px] w-[13px] shrink-0" strokeWidth={2.4} aria-hidden /> : null}
                {s.label}
                {isActive ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-frenz-gradient-x" /> : null}
              </button>
            );
          })}
        </div>

        {/* Grid ⇄ list — one button that says what it will switch to */}
        {showViewToggle ? (
          <button
            type="button"
            onClick={() => chooseView(view === "grid" ? "list" : "grid")}
            aria-label={view === "grid" ? "Switch to list view" : "Switch to grid view"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-frenz-ink/80 transition-colors hover:bg-frenz-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
          >
            {view === "grid" ? <ListViewIcon size={20} /> : <LayoutGrid className="h-5 w-5" aria-hidden />}
          </button>
        ) : null}
      </nav>

      {/* A single mounted content region that swaps instantly */}
      {renderActive()}
    </div>
  );
}
