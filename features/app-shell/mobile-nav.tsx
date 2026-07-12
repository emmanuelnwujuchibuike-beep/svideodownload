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
 * Floating pill bottom navigation — rebuilt 2026-07-12 to match the owner's
 * mockup FAITHFULLY (see [[feedback-never-simplify-instructions]]): inactive
 * tabs are plain, muted outline icons with a label (no badge tiles down
 * here); the ACTIVE tab's icon rides a raised gradient circle that pops
 * above the pill's top edge on a soft glow; the Create button is the
 * mockup's gradient circle. Destinations are this app's real ones (the
 * mockup's placeholder "Market"→Friends, "Save"→Chats per the owner's
 * explicit ask). Every tab tap fires the shared haptic + the soft nav "tap"
 * tone (owner ask: "add haptic sound in webapp nav buttons").
 *
 * Perf: the glow/circle are STATIC (no idle animation); only the lift spring
 * and PressIcon's tap spring ever animate, both input-driven. The pill hugs
 * the bottom with `max(safe-area, 8px)` — on iOS standalone that's exactly
 * the home-indicator inset (previously safe-area PLUS extra padding, which
 * made the whole bar float visibly too high in the installed app).
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
    // Safe-area handling (owner: "make the bottom nav go down to fit the
    // webapp perfectly"): the pill deliberately tucks INTO the home-indicator
    // inset — max(inset − 10px, 6px) — like the mockup, where the indicator
    // overlaps just below the labels, instead of stacking padding on top of
    // the inset (which made the whole bar float visibly too high in the
    // installed app). Browser tabs (inset 0) get a slim 6px edge gap.
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(calc(env(safe-area-inset-bottom)-10px),0.375rem)] lg:hidden">
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

        {/* Profile (avatar-in-circle, same raised treatment when active) */}
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
                  "flex items-center justify-center rounded-full transition",
                  profileActive ? "h-6 w-6 bg-white/90 text-[hsl(var(--brand-purple))]" : "bg-brand-tile h-6 w-6 text-white",
                )}
              >
                <FrenzPersonSolid className="h-3.5 w-3.5" />
              </span>
            </PressIcon>
          </NavLift>
          <span className={cn("text-[10px] font-medium transition-colors", profileActive ? "text-foreground" : "text-muted-foreground")}>Profile</span>
        </Link>
      </nav>
    </div>
  );
}

/**
 * The mockup's raised active state: the icon sits inside a gradient circle
 * that lifts above the pill's top edge on a static glow halo. Inactive
 * children render as-is (plain muted icon). Lift is spring-animated on
 * activation only — zero idle animation cost.
 */
function NavLift({ active, children }: { active: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      className="relative flex h-8 w-8 items-center justify-center"
      animate={reduceMotion ? undefined : { y: active ? -16 : 0 }}
      transition={reduceMotion ? { duration: 0 } : springs.bounce}
    >
      {active ? (
        <>
          <span aria-hidden className="bg-brand pointer-events-none absolute -inset-3 -z-20 rounded-full opacity-35 blur-lg" />
          <span aria-hidden className="bg-brand absolute -inset-2.5 -z-10 rounded-full shadow-lg shadow-violet-500/40 ring-[3px] ring-card/80" />
        </>
      ) : null}
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
          <Glyph className={cn("h-[22px] w-[22px] transition-colors", active ? "text-white" : "text-muted-foreground")} />
          {badge > 0 ? (
            <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
      <span className={cn("text-[10px] font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
