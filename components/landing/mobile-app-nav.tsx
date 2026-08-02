"use client";

import { motion, useReducedMotion } from "framer-motion";
import { History, Headset } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";

import {
  FrenzHomeOutline,
  FrenzHomeSolid,
  FrenzPersonSolid,
  FrenzReelsOutline,
  FrenzReelsSolid,
} from "@/components/icons/frenz-icons";
import { PressIcon } from "@/components/motion/press-icon";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
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
 * ── Real routes only ──────────────────────────────────────────────────────────
 * Home → the landing; Reels → the full-screen deck; History → the download library;
 * Support → the help + 1:1 admin-chat page; Profile → the landing profile doorway.
 * The active item is derived from the CURRENT path (usePathname). Mobile only.
 *
 * ── Perf ──────────────────────────────────────────────────────────────────────
 * No idle animation anywhere — only NavLift's active spring and PressIcon's tap
 * spring ever animate, both input/state-driven. The drop-shadow is static (painted
 * once per state), so it never costs a frame on a low-end device.
 */
type NavGlyph = ComponentType<{ className?: string; strokeWidth?: number | string }>;

const ITEMS: { href: string; label: string; icon: NavGlyph; activeIcon: NavGlyph }[] = [
  { href: "/", label: "Home", icon: FrenzHomeOutline, activeIcon: FrenzHomeSolid },
  { href: "/reels", label: "Reels", icon: FrenzReelsOutline, activeIcon: FrenzReelsSolid },
  { href: "/library", label: "History", icon: History, activeIcon: History },
  { href: "/support", label: "Support", icon: Headset, activeIcon: Headset },
  { href: "/profile", label: "Profile", icon: FrenzPersonSolid, activeIcon: FrenzPersonSolid },
];

// Subtle "3D" depth on the glyph so it sits raised off the flat bar — the active
// tab glows in the brand hue, the inactive ones carry a barely-there emboss. Shared
// verbatim with the signed-in nav so both bars read as the same material.
const GLYPH_ACTIVE = "text-primary [filter:drop-shadow(0_2px_6px_rgba(79,70,229,0.5))]";
const GLYPH_INACTIVE = "text-muted-foreground [filter:drop-shadow(0_1px_1.5px_rgba(2,6,23,0.14))]";

/** Is `href` the active route for the current path? Home matches only exactly;
 *  the others match their section (so /reels/123 still lights up Reels). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileAppNav() {
  const pathname = usePathname() || "/";
  const navRef = useRef<HTMLElement | null>(null);

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
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-around border-t border-border/60 bg-background px-1 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-2.5 lg:hidden"
    >
      {ITEMS.map((item) => (
        <NavTab key={item.label} {...item} active={isActive(pathname, item.href)} />
      ))}
    </nav>
  );
}

/** A couple of px of spring-animated lift when a tab becomes active — the same
 *  micro-lift the signed-in nav uses, never a floating badge. */
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
  href,
  label,
  icon: Icon,
  activeIcon: ActiveIcon,
  active,
}: {
  href: string;
  label: string;
  icon: NavGlyph;
  activeIcon: NavGlyph;
  active: boolean;
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
          <Glyph strokeWidth={2.1} className={cn("h-6 w-6 transition-colors", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
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
    </Link>
  );
}
