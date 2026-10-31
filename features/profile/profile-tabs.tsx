"use client";

import { LayoutGrid, Lock } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";

import { ListViewIcon } from "@/features/frenz-ui/icons";
import { useTabSwipe } from "@/features/profile/use-tab-swipe";
import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import { loadSubPosts } from "@/features/sub/sub-posts-cache";
import { useStickyState } from "@/features/ui/use-sticky-state";
import type { PostCard } from "@/lib/social/posts";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";
import type { BundlePrices, SubOption } from "@/lib/sub/pricing";

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
  /** 0277: `options` — every prepaid duration on offer (1 / 3 / 6 / 12 months) with its promotion, from the server */
  quote: { priceCents: number; feeCents: number; totalCents: number; feePercent: number; periodDays: number; options?: SubOption[] } | null;
  settings: { priceCents: number | null; active: boolean; setupStep: number; setupCompleted: boolean; promoDismissed?: boolean; notifySubscribed?: "off" | "push" | "email" | "both"; bundlePrices?: BundlePrices; bundlesReady?: boolean } | null;
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

  // Swipe between sections (owner, 2026-10-19). Every section once shown stays mounted (hidden), and the two
  // beside the current one are mounted the moment a finger lands — so a swipe slides in real content, never a
  // loader, and coming back is instant. Nothing extra is fetched until someone touches the sections.
  const order = keys;
  const at = order.indexOf(active);
  const prevKey = at > 0 ? order[at - 1]! : null;
  const nextKey = at >= 0 && at < order.length - 1 ? order[at + 1]! : null;
  const [mounted, setMounted] = useState<string[]>(() => [active]);
  const mount = (...ks: (string | null)[]) =>
    setMounted((m) => {
      const add = ks.filter((k): k is string => !!k && !m.includes(k));
      return add.length ? [...m, ...add] : m;
    });
  useEffect(() => setMounted((m) => (m.includes(active) ? m : [...m, active])), [active]);
  const region = useRef<HTMLDivElement>(null);
  const trackEl = useRef<HTMLDivElement>(null);
  const tabRow = useRef<HTMLDivElement>(null);
  const peek = useTabSwipe({
    region,
    track: trackEl,
    prev: prevKey,
    next: nextKey,
    active,
    onIntent: () => {
      mount(prevKey, nextKey);
      if (prevKey === SUB_TAB_KEY || nextKey === SUB_TAB_KEY) void loadSubPosts(ownerId).catch(() => {});
    },
    onCommit: (k) => select(k),
  });
  // the chosen tab stays in view in the row when a swipe moves past the visible ones
  useEffect(() => {
    const row = tabRow.current;
    const btn = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !btn) return;
    const l = btn.offsetLeft; // the row is the buttons' offset parent (it holds the sliding underline)
    if (l < row.scrollLeft || l + btn.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: l - 16, behavior: "smooth" });
  }, [active]);

  /*
    Owner 2026-10-31: "this profile nav should also navigate like the bottom nav — spring press, smooth when moving".
    ONE underline, measured to the chosen tab and springing to the next one on the bottom nav lens's own curve
    (--ease-spring, 500 ms); each label springs on press (PressIcon) and a tap gives the nav's haptic + tap tone.
    It lives inside the scrolling row, so it scrolls with the tabs. The first placement lands without a slide.
  */
  const tabBtns = useRef<Record<string, HTMLButtonElement | null>>({});
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const [springs, setSprings] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);
  useLayoutEffect(() => {
    const measure = () => {
      const el = tabBtns.current[active];
      // inset 12px each side — the same span the old per-tab underline (inset-x-3) drew
      setBar(el ? { x: el.offsetLeft + 12, w: Math.max(0, el.offsetWidth - 24) } : null);
    };
    measure();
    const row = tabRow.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [active, sections]);
  useEffect(() => {
    if (!bar || springs) return;
    const id = requestAnimationFrame(() => setSprings(true));
    return () => cancelAnimationFrame(id);
  }, [bar, springs]);

  const renderPanel = (active: string) => {
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
      <nav ref={tray} id="profile-sections" aria-label="Profile sections" className="frenz-ui relative -mx-4 mb-3 flex scroll-mt-24 items-center border-b border-frenz-line px-2 sm:-mx-6">
        {/* sideways only (owner, 2026-10-19: the row moved up and down) — nothing overflows vertically, and touch pans x only */}
        <div ref={tabRow} className="relative flex min-w-0 flex-1 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => {
            const isActive = active === s.key;
            return (
              <button
                key={s.key}
                ref={(el) => {
                  tabBtns.current[s.key] = el;
                }}
                type="button"
                onClick={() => {
                  if (s.key !== active) {
                    haptic("light");
                    playSound("tap");
                  }
                  select(s.key);
                }}
                // SUB POSTS: start loading the moment a finger lands, so the gallery opens already filled
                onPointerDown={s.key === SUB_TAB_KEY ? () => void loadSubPosts(ownerId).catch(() => {}) : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-12 shrink-0 items-center gap-1 px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-frenz-violet",
                  isActive ? "font-bold text-frenz-ink" : "font-semibold text-frenz-muted hover:text-frenz-ink",
                )}
              >
                <PressIcon className="inline-flex items-center gap-1">
                  {s.key === SUB_TAB_KEY ? <Lock className="h-[13px] w-[13px] shrink-0" strokeWidth={2.4} aria-hidden /> : null}
                  {s.label}
                </PressIcon>
                {/* until the row has measured itself (server render), a static underline marks the tab */}
                {isActive && !bar ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-frenz-gradient-x" /> : null}
              </button>
            );
          })}
          {bar ? (
            <span
              aria-hidden
              data-profile-tab-underline
              className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-frenz-gradient-x"
              style={{
                width: bar.w,
                transform: `translateX(${bar.x}px)`,
                transition: springs && !reducedMotion ? "transform 500ms var(--ease-spring), width 500ms var(--ease-spring)" : "none",
              }}
            />
          ) : null}
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

      {/*
        The content region: the current section in the page's flow, the others it has shown kept mounted
        and hidden, and — while a finger drags — the next one drawn beside it on the same track.
      */}
      {/*
        Full width (out over the page gutter, like the tab row above) with the gutter put back as padding (owner,
        2026-10-26, a screenshot: "white border edge in the profile page"). The clip is at the padding edge, so the
        post grid's own edge-to-edge bleed (-mx-4, profile-media-grid.tsx) is no longer cut off on both sides — which
        left a white strip each side and clipped the first and last columns. Every other section keeps its gutter.
      */}
      <div ref={region} className="relative -mx-4 overflow-x-clip px-4 sm:-mx-6 sm:px-6">
        {/* no will-change: a standing transform would trap the Exclusive tab's fixed sheets inside the track */}
        <div ref={trackEl} className="relative">
          {(peek && !mounted.includes(peek.key) ? [...mounted, peek.key] : mounted).map((k) => (
            <div
              key={k}
              hidden={k !== active && peek?.key !== k}
              aria-hidden={k !== active || undefined}
              className={k !== active ? cn("absolute inset-x-0 top-0", peek?.side === "left" ? "-translate-x-full" : "translate-x-full") : undefined}
            >
              {renderPanel(k)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
