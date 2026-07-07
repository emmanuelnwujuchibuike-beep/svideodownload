"use client";

import type { ComponentType } from "react";
import {
  IoChatbubbleEllipses,
  IoChatbubbleEllipsesOutline,
  IoHome,
  IoHomeOutline,
  IoPeopleCircle,
  IoPeopleCircleOutline,
  IoPerson,
} from "react-icons/io5";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { openUpload } from "@/features/create/upload-store";
import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { cn } from "@/lib/utils";

/**
 * TikTok-style bottom navigation — the mobile spine of the app: Home, Friends,
 * Create (center), Inbox (live unread badge via the shared inbox cache), and
 * Profile. Every tab is a client-side <Link> (SPA transition into the
 * persistent app shell), and it renders on /u and /p pages too so navigation
 * never disappears on mobile.
 */
export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { handle } = useEntitlements();
  // Cached-first: shows the last-known unread count instantly, updates live.
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox);
  const unread = inbox?.unread ?? 0;

  const profileHref = handle ? `/u/${handle}` : "/account";
  const profileActive = pathname.startsWith("/u/") || pathname.startsWith("/account");

  // Warm the primary destinations once so the FIRST tap opens instantly — dynamic
  // routes (Messages/Friends) otherwise fetch on first navigation, which felt like
  // "tap twice before it opens". Runs after mount so it never blocks first paint.
  useEffect(() => {
    const id = setTimeout(() => {
      for (const r of ["/home", "/friends", "/messages", profileHref]) router.prefetch(r);
    }, 400);
    return () => clearTimeout(id);
  }, [router, profileHref]);

  return (
    <nav
      aria-label="Primary"
      // backdrop-blur-lg (not -2xl): this bar sits over scrolling content on
      // every mobile page for the app's whole lifetime — the same perf trim
      // already applied to the feed's sticky segmented control (smart-feed.tsx).
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border/25 bg-background/75 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur-lg lg:hidden"
    >
      <NavTab label="Home" href="/home" icon={IoHomeOutline} activeIcon={IoHome} active={pathname === "/home"} onWarm={router.prefetch} />
      <NavTab label="Friends" href="/friends" icon={IoPeopleCircleOutline} activeIcon={IoPeopleCircle} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />

      {/* Signature create button — an elevated gradient orb with a soft halo.
          Uniquely Frenz: a clean circular FAB that reads as premium, not TikTok. */}
      <button type="button" onClick={() => openUpload("post")} aria-label="Create" className="group relative -mt-6 flex h-14 w-14 items-center justify-center transition-transform duration-100 active:scale-90">
        <span aria-hidden className="absolute inset-1 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 opacity-50 blur-md transition group-active:opacity-70" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/40 ring-4 ring-background">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </button>

      <NavTab
        label="Inbox"
        href="/messages"
        icon={IoChatbubbleEllipsesOutline}
        activeIcon={IoChatbubbleEllipses}
        active={pathname.startsWith("/messages")}
        badge={unread}
        onWarm={router.prefetch}
      />

      {/* Profile (Instagram-style avatar) */}
      <Link href={profileHref} onPointerDown={() => router.prefetch(profileHref)} className="flex flex-col items-center gap-0.5 px-2 py-1 transition-transform duration-100 active:scale-90">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white ring-2 transition", profileActive ? "ring-primary" : "ring-transparent")}>
          <IoPerson className="h-3.5 w-3.5" />
        </span>
        <span className={cn("text-[10px] font-medium", profileActive ? "text-foreground" : "text-muted-foreground")}>Profile</span>
      </Link>
    </nav>
  );
}

function NavTab({
  label,
  href,
  icon: Icon,
  activeIcon: ActiveIcon,
  active,
  badge = 0,
  onWarm,
}: {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  activeIcon: ComponentType<{ className?: string }>;
  active: boolean;
  badge?: number;
  onWarm?: (href: string) => void;
}) {
  const Glyph = active ? ActiveIcon : Icon;
  return (
    <Link href={href} onPointerDown={() => onWarm?.(href)} className="relative flex flex-col items-center gap-0.5 px-2 py-1 transition-transform duration-100 active:scale-90">
      {active ? <span aria-hidden className="absolute -top-[7px] h-1 w-6 rounded-full bg-gradient-to-r from-blue-500 to-violet-600 shadow-[0_0_8px] shadow-violet-500/50" /> : null}
      <span className="relative">
        <Glyph className={cn("h-[26px] w-[26px] transition", active ? "text-foreground" : "text-muted-foreground")} />
        {badge > 0 ? (
          <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span className={cn("text-[10px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
