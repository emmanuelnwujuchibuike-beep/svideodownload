"use client";

import { History, Headset } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";

import {
  FrenzFriendsOutline,
  FrenzFriendsSolid,
  FrenzHomeOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzInboxSolid,
  FrenzPersonSolid,
  FrenzReelsOutline,
  FrenzReelsSolid,
} from "@/components/icons/frenz-icons";
import { PressIcon } from "@/components/motion/press-icon";
import { useAppMode } from "@/features/app-shell/use-app-mode";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * The app-style bottom nav for the marketing site — a plain, OPAQUE, edge-to-edge
 * bar (owner, 2026-08: "remove the glass feel and transparent look and make it edge
 * to edge, only native apps will have glass floating nav"). Matches the signed-in
 * bottom nav (features/app-shell/mobile-nav.tsx): full-width, square corners, solid
 * `bg-background`, a hairline top border, NO blur.
 *
 * ── Premium, alive, 3D (owner, 2026-08-02) ────────────────────────────────────
 * "make the bottom NAV and icon button to be more high end premium that feels alive
 * with motion and haptic sound when click … a bit more height with 3d bolder icon."
 * Every tab now carries the same spring-lift + press compression the signed-in nav
 * uses (NavLift + PressIcon), fires the shared haptic + soft "tap" tone on press,
 * and renders a bolder glyph (heavier stroke, 24px) with a subtle drop-shadow so it
 * reads as raised off the bar — the active tab's shadow is a brand-tinted glow. The
 * bar itself is a touch taller. Active still reads as a flat inline color change
 * (muted → brand blue), Facebook/Snapchat style, never a raised gradient badge.
 *
 * ── Mode-aware destinations (owner, 2026-08-02) ───────────────────────────────
 * The bar STICKS with the viewer's experience mode so a marketing page (e.g.
 * Support) never dumps a Full-Bleed user back into the landing chrome:
 *   • signed-in + Full Bleed → the app destinations (Home, Friends, Reels, Chats,
 *     Profile) so they stay "in the app".
 *   • Downloader mode / signed-out → the downloader destinations (Home, Reels,
 *     History, Support, Profile).
 * A signed-in user's Profile always points at their REAL profile (/u/handle), not
 * the sign-in doorway (owner: "the profile page in the landing should be the user's
 * profile"). The active item is derived from the CURRENT path (usePathname).
 *
 * ── Perf ──────────────────────────────────────────────────────────────────────
 * No idle animation anywhere — only NavLift's active spring and PressIcon's tap
 * spring ever animate, both input/state-driven. The drop-shadow is static (painted
 * once per state), so it never costs a frame on a low-end device.
 */
type NavGlyph = ComponentType<{ className?: string; strokeWidth?: number | string }>;
type NavItem = { href: string; label: string; icon: NavGlyph; activeIcon: NavGlyph; avatarUrl?: string | null };

/** The destinations for the viewer's mode. `homeHref` is the download page for a
 *  signed-in Downloader user, else the landing; `profileHref` is their real profile
 *  when signed in, else the sign-in doorway; `avatarUrl` shows on the Profile tab. */
function navItems(fullBleed: boolean, homeHref: string, profileHref: string, avatarUrl: string | null): NavItem[] {
  const profile: NavItem = { href: profileHref, label: "Profile", icon: FrenzPersonSolid, activeIcon: FrenzPersonSolid, avatarUrl };
  if (fullBleed) {
    return [
      { href: "/home", label: "Home", icon: FrenzHomeOutline, activeIcon: FrenzHomeSolid },
      { href: "/friends", label: "Friends", icon: FrenzFriendsOutline, activeIcon: FrenzFriendsSolid },
      { href: "/reels", label: "Reels", icon: FrenzReelsOutline, activeIcon: FrenzReelsSolid },
      { href: "/messages", label: "Chats", icon: FrenzInboxOutline, activeIcon: FrenzInboxSolid },
      profile,
    ];
  }
  return [
    { href: homeHref, label: "Home", icon: FrenzHomeOutline, activeIcon: FrenzHomeSolid },
    { href: "/reels", label: "Reels", icon: FrenzReelsOutline, activeIcon: FrenzReelsSolid },
    { href: "/history", label: "History", icon: History, activeIcon: History },
    { href: "/support", label: "Support", icon: Headset, activeIcon: Headset },
    profile,
  ];
}

/*
  ── Bolder 3D, darker lining (owner, 2026-08-16: "more 3D… make the lining
  and icon color more contrast to be more darker and no be more lively, and
  in a professional premium shape and style, without breaking the performance
  at all") ────────────────────────────────────────────────────────────────

  Every value below is STATIC — a `filter`/`box-shadow` painted once per
  active/inactive state change, never animated on a timer or a scroll
  listener, so this costs nothing beyond the one-time paint the bar already
  had. No new element, no new class of work, only stronger values on the
  exact same properties that were already there.

  The inactive glyph moves off `text-muted-foreground` (a light-to-mid grey
  that reads as "faded" at a glance on a bright bar) onto an explicit darker
  slate, so the un-selected tabs read as present controls rather than as
  ghosted ones — "more contrast… more darker" specifically named the icons,
  not just the active state. The drop-shadows on both states deepen (more
  blur, more spread, higher opacity) for a more pronounced raised-off-the-bar
  read, matching "more 3D… more lively" without changing the flat-colour
  active/inactive language the owner explicitly kept from the last pass.
*/
const GLYPH_ACTIVE = "text-primary [filter:drop-shadow(0_3px_8px_rgba(79,70,229,0.65))]";
const GLYPH_INACTIVE = "text-slate-600 dark:text-slate-300 [filter:drop-shadow(0_2px_3px_rgba(2,6,23,0.24))]";

/** Is `href` the active route for the current path? Home matches only exactly;
 *  the others match their section (so /reels/123 still lights up Reels). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileAppNav() {
  const pathname = usePathname() || "/";
  const navRef = useRef<HTMLElement | null>(null);
  const mode = useAppMode();
  const { handle, avatarUrl } = useEntitlements();
  const signedIn = !!handle;
  const profileHref = signedIn ? `/u/${handle}` : "/profile";
  // Home: the signed-in download page for a Downloader user (owner), the landing
  // for a signed-out visitor. Full Bleed uses /home directly.
  const homeHref = signedIn ? "/downloads" : "/";
  // Signed-in + Full Bleed → app destinations; Downloader / signed-out → downloader
  // destinations. So Support (and every marketing page) keeps the viewer's mode.
  const items = navItems(signedIn && mode === "full", homeHref, profileHref, avatarUrl);

  // Publish the nav's height (which already includes the home-indicator safe-area
  // pad) so the fixed bottom ad bar can dock directly above it. On desktop this nav
  // is display:none, so offsetHeight is 0 and the ad rests on the safe-area inset.
  useEffect(() => {
    const el = navRef.current;
    const root = document.documentElement;
    if (!el) return;
    const setH = () => root.style.setProperty("--frenz-bottomnav-h", `${el.offsetHeight}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-bottomnav-h", "0px");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="App"
      // Edge-to-edge, flush with the true bottom of the viewport — the bar itself
      // owns the safe-area inset. A touch taller than before (owner ask).
      /*
        `border-border` (full strength, was `/60`) is the darker "lining" —
        a crisper edge instead of a faint one. `shadow-[0_-4px_16px_...]` is
        a single, STATIC elevation shadow ABOVE the bar (painted once, same
        cost as the border it sits beside) — the "more 3D" read of the whole
        surface lifting off the page, not just its icons.
      */
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-border bg-background px-1 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-2.5 shadow-[0_-4px_16px_-4px_rgba(2,6,23,0.12)] dark:shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.4)] lg:hidden"
    >
      {items.map((item) => (
        <NavTab key={item.label} {...item} active={isActive(pathname, item.href)} />
      ))}
    </nav>
  );
}

/**
 * A couple of px of lift when a tab becomes active — the same micro-lift the
 * signed-in nav uses, never a floating badge.
 *
 * ── Why this is CSS and not framer-motion ────────────────────────────────
 * It used to be a `motion.span`, and that ONE element pulled the whole of
 * framer-motion — 39 kB gzipped — into the LANDING page's first load. The
 * result card that genuinely needs the library is already lazy-loaded; this
 * nav was the only thing keeping it on the cold-entry path, for a two-pixel
 * translate.
 *
 * A CSS transform does the same thing on the compositor, costs nothing, and
 * honours `prefers-reduced-motion` through the shared `motion-reduce` variant
 * rather than a hook that has to run on every render.
 */
function NavLift({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-8 items-center justify-center transition-transform duration-300 [transition-timing-function:var(--ease-spring)] motion-reduce:transition-none",
        active ? "-translate-y-0.5" : "translate-y-0",
      )}
    >
      {children}
    </span>
  );
}

function NavTab({
  href,
  label,
  icon: Icon,
  activeIcon: ActiveIcon,
  active,
  avatarUrl,
}: {
  href: string;
  label: string;
  icon: NavGlyph;
  activeIcon: NavGlyph;
  active: boolean;
  avatarUrl?: string | null;
}) {
  const Glyph = active ? ActiveIcon : Icon;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      prefetch
      onClick={() => {
        haptic("light");
        playSound("tap");
      }}
      className="flex flex-1 flex-col items-center gap-1 py-0.5"
    >
      <NavLift active={active}>
        <PressIcon active={active}>
          {avatarUrl ? (
            // The Profile tab shows the member's real picture (owner) — same as the
            // signed-in app nav — with an accent ring when active.
            <span className={cn("flex h-7 w-7 items-center justify-center overflow-hidden rounded-full", active && "ring-2 ring-primary ring-offset-1 ring-offset-background")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            </span>
          ) : (
            <Glyph strokeWidth={2.1} className={cn("h-6 w-6 transition-colors", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
          )}
        </PressIcon>
      </NavLift>
      <span
        className={cn(
          "text-[10px] font-semibold leading-none transition-colors",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {/*
        🔴 The active UNDERLINE (owner, 2026-08-11: follow
        `public/newnativeapplandingpage.jpg` — "the bottom nav and everything").

        The reference draws a short accent rule under the active tab's label.
        It is not decoration: colour alone was the only thing marking the current
        tab, and a second, non-colour channel is what makes that readable to
        someone who cannot separate violet from grey. `aria-current="page"` on
        the link above already carries it for assistive tech; this carries it
        visually.

        A static element, not an animated indicator that slides between tabs — a
        shared-layout animation here would mean a client-side measurement and a
        transform on every navigation, on the page whose whole brief is to stay
        cheap and cool. It costs one span and no JavaScript.
      */}
      <span
        aria-hidden
        className={cn(
          "mt-1 h-[2px] w-5 rounded-full transition-colors",
          active ? "bg-primary" : "bg-transparent",
        )}
      />
    </Link>
  );
}
