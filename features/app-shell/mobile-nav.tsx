"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import {
  FrenzFriendsOutline,
  FrenzFriendsSolid,
  FrenzHomeOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzInboxSolid,
  FrenzPersonSolid,
} from "@/components/icons/frenz-icons";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { openUpload } from "@/features/create/upload-store";
import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { springs } from "@/lib/motion/springs";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { cn } from "@/lib/utils";

/**
 * Floating pill bottom navigation. Inactive tabs are plain, muted outline
 * icons with a label; the ACTIVE tab swaps to its solid glyph in the brand
 * blue (`text-primary`) — a flat inline color change, Facebook/Snapchat
 * style, corrected 2026-07-12 from an earlier raised-circle-with-glow-halo
 * treatment the owner found sat "too far up" and read as immature. Only a
 * couple of px of spring-animated lift remain (see NavLift) — never a
 * floating badge. The Create button is the one deliberately different
 * element: a permanently-raised gradient circle, untouched by this
 * correction. Destinations are this app's real ones (the mockup's
 * placeholder "Market"→Friends, "Save"→Chats per the owner's explicit ask).
 * Every tab tap fires the shared haptic + the soft nav "tap" tone.
 *
 * Perf: no idle animation anywhere in this bar — only the micro-lift spring
 * and PressIcon's tap spring ever animate, both input-driven. The pill hugs
 * the bottom with `max(safe-area − 10px, 2px)` — on iOS standalone that's
 * the home-indicator inset; a plain browser tab now sits almost flush with
 * the viewport edge (owner: "bring it down more to fit well on webapp like
 * tiktok").
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
  // Skipped entirely on data-saver/2G — this fires unconditionally regardless
  // of whether the user ever taps those tabs, unlike the hover/press-triggered
  // prefetches below (onWarm/onPointerDown), which stay on: those only spend
  // bandwidth once the user has already shown real intent to navigate there.
  useEffect(() => {
    if (isSlowConnection()) return;
    const id = setTimeout(() => {
      for (const r of ["/home", "/friends", "/messages", profileHref]) router.prefetch(r);
    }, 400);
    return () => clearTimeout(id);
  }, [router, profileHref]);

  return (
    // Safe-area handling (owner: "bring the bottom nav down more to fit well
    // on webapp like tiktok"): the pill tucks INTO the home-indicator inset —
    // max(inset − 10px, 2px) — on a notched/installed device the indicator
    // overlaps just below the labels; a plain browser tab (inset 0) now sits
    // almost flush with the viewport edge instead of leaving a visible gap.
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(calc(env(safe-area-inset-bottom)-10px),0.125rem)] lg:hidden">
      <nav
        aria-label="Primary"
        // backdrop-blur-lg (not -2xl): this bar sits over scrolling content on
        // every mobile page for the app's whole lifetime — the same perf trim
        // already applied to the feed's sticky segmented control (smart-feed.tsx).
        className="glass-strong relative mx-auto flex max-w-md items-end justify-around rounded-full px-2 pb-1.5 pt-2 backdrop-blur-lg"
      >
        <NavTab label="Home" href="/home" icon={FrenzHomeOutline} activeIcon={FrenzHomeSolid} active={pathname === "/home"} onWarm={router.prefetch} />
        <NavTab label="Friends" href="/friends" icon={FrenzFriendsOutline} activeIcon={FrenzFriendsSolid} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />

        {/* Create — the mockup's signature gradient circle, slightly raised
            out of the pill. (Replaces the earlier dark-squircle treatment to
            follow the owner's re-sent mockup exactly.) */}
        <PressIcon className="-mt-5 self-center">
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              playSound("tap");
              openUpload("post");
            }}
            aria-label="Create"
            className="group relative flex h-[52px] w-[52px] items-center justify-center"
          >
            <span aria-hidden className="bg-brand absolute inset-0 rounded-full opacity-45 blur-[10px] transition group-active:opacity-70" />
            <span className="bg-brand relative flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lg shadow-violet-500/30 ring-[3px] ring-card/80">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </button>
        </PressIcon>

        <NavTab
          label="Chats"
          href="/messages"
          icon={FrenzInboxOutline}
          activeIcon={FrenzInboxSolid}
          active={pathname.startsWith("/messages")}
          badge={unread}
          onWarm={router.prefetch}
        />

        {/* Profile (avatar-in-circle) — active state is now a colored ring
            accent on the same tile, not a different fill entirely, matching
            the inline-color-change treatment the other tabs use. */}
        <Link
          href={profileHref}
          onPointerDown={() => router.prefetch(profileHref)}
          onClick={() => {
            haptic("light");
            playSound("tap");
          }}
          className="relative flex flex-col items-center gap-1 px-2 pb-0.5"
        >
          <NavLift active={profileActive}>
            <PressIcon active={profileActive}>
              <span
                className={cn(
                  "bg-brand-tile flex h-6 w-6 items-center justify-center rounded-full text-white transition",
                  profileActive && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
              >
                <FrenzPersonSolid className="h-3.5 w-3.5" />
              </span>
            </PressIcon>
          </NavLift>
          <span className={cn("text-[10px] font-medium transition-colors", profileActive ? "text-primary" : "text-muted-foreground")}>Profile</span>
        </Link>
      </nav>
    </div>
  );
}

/**
 * Active state, corrected (owner: "too far up — make it an inline icon
 * color change just like facebook and snapchat nav hover so it looks
 * matured"): the raised gradient-circle-with-glow-halo this used to be is
 * gone. Active now reads purely as a color change (outline → solid glyph,
 * muted gray → brand blue) with only a couple of pixels of lift — "inline,
 * or a bit above the nav container line," never a floating badge. Same
 * spring-animated micro-lift + PressIcon's tap scale either way, so the
 * motion still feels alive even though there's no more halo.
 */
function NavLift({ active, children }: { active: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      className="relative flex h-8 w-8 items-center justify-center"
      animate={reduceMotion ? undefined : { y: active ? -2 : 0 }}
      transition={reduceMotion ? { duration: 0 } : springs.bounce}
    >
      {children}
    </motion.span>
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
    <Link
      href={href}
      onPointerDown={() => onWarm?.(href)}
      onClick={() => {
        haptic("light");
        playSound("tap");
      }}
      className="relative flex flex-col items-center gap-1 px-2 pb-0.5"
    >
      <NavLift active={active}>
        <PressIcon active={active} className="relative">
          <Glyph className={cn("h-[22px] w-[22px] transition-colors", active ? "text-primary" : "text-muted-foreground")} />
          {badge > 0 ? (
            <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
      <span className={cn("text-[10px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
