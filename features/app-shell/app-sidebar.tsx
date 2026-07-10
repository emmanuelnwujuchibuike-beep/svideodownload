"use client";

import type { ComponentType } from "react";
import { Crown } from "lucide-react";
import {
  IoBookmark,
  IoBookmarkOutline,
  IoCompass,
  IoCompassOutline,
  IoDownload,
  IoDownloadOutline,
  IoFilm,
  IoFilmOutline,
  IoFlame,
  IoFlameOutline,
  IoNewspaper,
  IoNewspaperOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoPeople,
  IoPeopleOutline,
  IoAdd,
} from "react-icons/io5";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { PressIcon } from "@/components/motion/press-icon";
import { NavIconBadge } from "@/components/icons/nav-icon-badge";
import { FrenzFriendsOutline, FrenzFriendsSolid, FrenzHomeOutline, FrenzHomeSolid } from "@/components/icons/frenz-icons";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

export interface NavItem {
  label: string;
  href: string;
  /** Outline glyph (inactive) + filled glyph (active) — the Instagram pattern. */
  icon: IconType;
  activeIcon: IconType;
  badge?: string;
  soon?: boolean;
}

// `_handle` kept for signature stability (mobile nav still passes it; profile
// deep links may return here when the Friends Hub grows tabs).
export function buildNav(_handle: string | null): NavItem[] {
  return [
    { label: "Home", href: "/home", icon: FrenzHomeOutline, activeIcon: FrenzHomeSolid },
    { label: "Explore", href: "/explore", icon: IoCompassOutline, activeIcon: IoCompass },
    { label: "Trending", href: "/explore?sort=trending", icon: IoFlameOutline, activeIcon: IoFlame },
    { label: "Reels", href: "/reels", icon: IoFilmOutline, activeIcon: IoFilm },
    { label: "News", href: "/blog", icon: IoNewspaperOutline, activeIcon: IoNewspaper },
    { label: "Communities", href: "/explore", icon: IoPeopleOutline, activeIcon: IoPeople, soon: true },
    { label: "Friends", href: "/friends", icon: FrenzFriendsOutline, activeIcon: FrenzFriendsSolid },
    { label: "Notifications", href: "/notifications", icon: IoNotificationsOutline, activeIcon: IoNotifications },
    { label: "Downloads", href: "/downloads", icon: IoDownloadOutline, activeIcon: IoDownload },
    { label: "Saved", href: "/saved", icon: IoBookmarkOutline, activeIcon: IoBookmark },
  ];
}

const SPACES = [
  { label: "Photography Club", color: "from-rose-500 to-pink-600" },
  { label: "Football Fans", color: "from-emerald-500 to-teal-600" },
  { label: "Music Lovers", color: "from-violet-500 to-purple-600" },
  { label: "Travel World", color: "from-sky-500 to-blue-600" },
];

export function AppSidebar({ handle }: { handle: string | null }) {
  const pathname = usePathname();
  const nav = buildNav(handle);
  const { showAds, ready } = useShowAds();
  const isPremium = ready && !showAds;

  return (
    <>
      {/* Reserves the sidebar's width in the flex row — the actual sidebar below
          is `fixed`, so it's out of normal flow and needs this to keep the
          content column pushed over by exactly w-64. */}
      <div className="hidden w-64 shrink-0 lg:block" aria-hidden />
      {/* `fixed` (not `sticky`) — sticky depends on the scroll geometry of its
          containing block, which broke under some full-screen overlays (the
          sidebar could end up scrolled to a mid-content position, leaving blank
          space below it instead of reaching the bottom of the screen). Fixed is
          pinned to the viewport unconditionally, so it can never move. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden border-r border-border/60 bg-gradient-to-b from-card/70 to-card/30 px-3 py-4 backdrop-blur-xl lg:flex">
      {/* Brand — the in-app "webapp logo": the dark-tiled app-icon mark, so it
          reads like the installed app icon rather than a bare glyph. */}
      <Link href="/home" className="mb-6 flex shrink-0 items-center px-2">
        <FrenzWordmark size={34} textClassName="text-lg" priority tile />
      </Link>

      {/* Scrollable middle — nav + spaces. Keeps the Premium card always visible
          at the bottom (it never gets cut off on shorter laptop screens). */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Primary nav */}
      <nav className="flex flex-col gap-1">
        {nav.map((item) => {
          const base = item.href.split("?")[0] ?? item.href;
          // Query-param variants (e.g. Trending → /explore?sort=) don't drive
          // active state; a path match does (incl. nested routes).
          const active = item.href.includes("?")
            ? false
            : base === "/home"
              ? pathname === "/home"
              : pathname === base || pathname.startsWith(`${base}/`);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => haptic("light")}
              className={cn(
                "group relative flex items-center gap-3.5 rounded-2xl px-3 py-2.5 text-[15px] font-semibold transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-blue-600/12 via-violet-600/10 to-transparent text-foreground shadow-[0_1px_0_0_hsl(var(--border))] ring-1 ring-inset ring-violet-500/25"
                  : "text-muted-foreground hover:translate-x-0.5 hover:bg-secondary/70 hover:text-foreground",
              )}
            >
              {/* Active accent bar */}
              {active ? (
                <span aria-hidden className="absolute -left-3 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-blue-500 to-violet-600 shadow-[0_0_12px_2px] shadow-violet-500/40" />
              ) : null}
              {(() => {
                const Icon = active ? item.activeIcon : item.icon;
                return (
                  <PressIcon active={active}>
                    <NavIconBadge icon={<Icon />} active={active} tileClassName="h-9 w-9" iconClassName="h-[18px] w-[18px] group-hover:text-foreground" />
                  </PressIcon>
                );
              })()}
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-1.5 text-[10px] font-bold text-white shadow-sm shadow-violet-500/40">{item.badge}</span>
              ) : item.soon ? (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Soon</span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Spaces */}
      <div className="mt-7">
        <p className="px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/50">Your Spaces</p>
        <div className="mt-2.5 flex flex-col gap-0.5">
          {SPACES.map((s) => (
            <Link key={s.label} href="/explore" className="group flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground">
              <span className={cn("h-7 w-7 rounded-xl bg-gradient-to-br shadow-sm ring-1 ring-inset ring-white/10 transition group-hover:scale-105", s.color)} />
              <span className="truncate">{s.label}</span>
            </Link>
          ))}
          <Link href="/explore" className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary/70">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
              <IoAdd className="h-4 w-4" />
            </span>
            Create New Space
          </Link>
        </div>
      </div>
      </div>
      {/* End scrollable middle */}

      {/* Premium card — pinned to the bottom, always fully visible */}
      {!isPremium ? (
        <div className="mt-3 shrink-0 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600/12 via-violet-600/12 to-purple-600/12 p-4 ring-1 ring-inset ring-violet-500/25">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
              <Crown className="h-3.5 w-3.5 fill-white" />
            </span>
            Frenz Premium
          </p>
          <ul className="mt-2.5 space-y-1 text-xs text-muted-foreground">
            <li>• No Ads</li>
            <li>• Download 4K videos</li>
            <li>• Faster downloads</li>
            <li>• And much more!</li>
          </ul>
          <Link
            href="/pricing"
            className="mt-3 flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2 text-xs font-bold text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 hover:shadow-lg hover:shadow-violet-500/40"
          >
            Upgrade Now
          </Link>
        </div>
      ) : null}
    </aside>
    </>
  );
}
