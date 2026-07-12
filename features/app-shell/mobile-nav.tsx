"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { NavIconBadge } from "@/components/icons/nav-icon-badge";
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
import { springs } from "@/lib/motion/springs";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { cn } from "@/lib/utils";

/**
 * TikTok-style bottom navigation — the mobile spine of the app: Home, Friends,
 * Create (center), Chats (live unread badge via the shared inbox cache), and
 * Profile. Every tab is a client-side <Link> (SPA transition into the
 * persistent app shell), and it renders on /u and /p pages too so navigation
 * never disappears on mobile.
 *
 * Owner (2026-07-12): restructured to a floating pill bar (glass-strong,
 * margin on every side instead of flush to the screen edges) with the
 * active tab's icon lifting on a persistent raised glow halo behind it —
 * adapted from a supplied HTML mockup, re-implemented with this app's real
 * destinations/data/icon system rather than the mockup's placeholder
 * Home/Market/Save/Profile labels (this app has no Marketplace; "Save" is
 * renamed "Chats" per the owner's explicit ask, since messaging is the real
 * second-most-visited destination here, not a save/bookmark shelf). The
 * halo is a STATIC blurred gradient (no idle animation) to keep this
 * always-mounted bar cheap on CPU/battery — only `PressIcon`'s existing tap
 * spring and the lift itself ever animate, both input-driven, never idle.
 * The Create FAB deliberately keeps its existing dark-squircle treatment
 * (an explicit prior owner correction — see frenz-motion-icon-system memory
 * — the mockup's bright gradient circle was NOT reapplied here).
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
    // Floating pill, not a flush full-width bar: margin on every side so the
    // bar reads as a distinct floating dock over the content rather than a
    // docked strip. Safe-area padding lives on this OUTER wrapper (not the
    // pill itself) so the pill's own shape/shadow stays a clean rounded
    // rectangle regardless of how tall the device's home-indicator inset is.
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] pt-1.5 lg:hidden">
      <nav
        aria-label="Primary"
        // backdrop-blur-lg (not -2xl): this bar sits over scrolling content on
        // every mobile page for the app's whole lifetime — the same perf trim
        // already applied to the feed's sticky segmented control (smart-feed.tsx).
        className="glass-strong relative mx-auto flex max-w-md items-center justify-around rounded-[28px] px-1.5 py-1.5 backdrop-blur-lg"
      >
        <NavTab label="Home" href="/home" icon={FrenzHomeOutline} activeIcon={FrenzHomeSolid} active={pathname === "/home"} onWarm={router.prefetch} />
        <NavTab label="Friends" href="/friends" icon={FrenzFriendsOutline} activeIcon={FrenzFriendsSolid} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />

        {/* Signature create button — balanced, not oversized: a modest -3.5 lift
            (not a floating orb), a distinct dark squircle (not another circle,
            not the brand gradient) so it reads as the one deliberate, different
            action in the bar rather than just another nav tab. Owner correction
            (2026-07-10): was the same circular brand-gradient tile every other
            "brand" tile used — asked for a different shape + a dark color
            specifically here, distinct from the rest of the nav. Frenz Motion
            press spring replaces the old ad-hoc active:scale. Kept unchanged
            through the 2026-07-12 floating-pill restructure — this shape/color
            is a deliberate prior correction, not something the new mockup's
            bright gradient FAB should override. */}
        <PressIcon className="-mt-3.5">
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              openUpload("post");
            }}
            aria-label="Create"
            className="group relative flex h-12 w-12 items-center justify-center"
          >
            <span aria-hidden className="absolute inset-0.5 rounded-2xl bg-neutral-800 opacity-40 blur-[6px] transition group-active:opacity-60" />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800 text-white shadow-md shadow-black/40 ring-[3px] ring-card">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
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

        {/* Profile (Instagram-style avatar) */}
        <Link
          href={profileHref}
          onPointerDown={() => router.prefetch(profileHref)}
          onClick={() => haptic("light")}
          className="relative flex flex-col items-center gap-0.5 px-2 py-1"
        >
          <NavLift active={profileActive}>
            <PressIcon active={profileActive}>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full bg-brand-tile text-white shadow-[0_2px_6px_-1px] shadow-[hsl(var(--brand-purple)/0.45)] ring-2 transition", profileActive ? "ring-foreground" : "ring-transparent")}>
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
 * Lifts its child (icon + badge) up on a persistent raised glow halo while
 * `active` — a static, non-animating blurred gradient circle (no idle
 * animation cost; the lift itself only ever moves on tap/route-change, both
 * input-driven). Separate from `PressIcon`'s momentary tap-bounce, which
 * still layers on top for the press feedback itself.
 */
function NavLift({ active, children }: { active: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      className="relative flex items-center justify-center"
      animate={reduceMotion ? undefined : { y: active ? -7 : 0 }}
      transition={reduceMotion ? { duration: 0 } : springs.bounce}
    >
      {active ? (
        <span
          aria-hidden
          className="bg-brand-tile pointer-events-none absolute -inset-2 -z-10 rounded-full opacity-30 blur-md"
        />
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
      onClick={() => haptic("light")}
      className="relative flex flex-col items-center gap-0.5 px-2 py-1"
    >
      <NavLift active={active}>
        <PressIcon active={active} className="relative">
          <NavIconBadge icon={<Glyph />} active={active} tileClassName="h-10 w-10" iconClassName="h-[19px] w-[19px]" />
          {badge > 0 ? (
            <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
      <span className={cn("text-[10px] font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
