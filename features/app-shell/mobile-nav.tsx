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

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border/60 bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur-xl lg:hidden"
    >
      <NavTab label="Home" href="/home" icon={IoHomeOutline} activeIcon={IoHome} active={pathname === "/home"} onWarm={router.prefetch} />
      <NavTab label="Friends" href="/friends" icon={IoPeopleCircleOutline} activeIcon={IoPeopleCircle} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />

      {/* TikTok-style center create button */}
      <button type="button" onClick={() => openUpload("post")} aria-label="Create post" className="relative -mt-1 flex h-8 w-[3.25rem] items-center justify-center">
        <span aria-hidden className="absolute inset-0 -translate-x-1 rounded-[0.7rem] bg-cyan-400" />
        <span aria-hidden className="absolute inset-0 translate-x-1 rounded-[0.7rem] bg-fuchsia-500" />
        <span className="relative flex h-8 w-[3.25rem] items-center justify-center rounded-[0.7rem] bg-white text-black shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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
      <Link href={profileHref} onPointerDown={() => router.prefetch(profileHref)} className="flex flex-col items-center gap-0.5 px-2 py-1">
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
    <Link href={href} onPointerDown={() => onWarm?.(href)} className="relative flex flex-col items-center gap-0.5 px-2 py-1">
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
