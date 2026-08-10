"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Headset, History } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
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
import { useAppMode } from "@/features/app-shell/use-app-mode";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { CreateActionSheet } from "@/features/create/create-action-sheet";
import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { springs } from "@/lib/motion/springs";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation — a plain, OPAQUE, edge-to-edge bar (owner, 2026-08:
 * "remove the glass feel and transparent look and make it edge to edge, only
 * native apps will have glass floating nav"). Reference: a native-style app's
 * bottom tab bar sits flush with the viewport's full width, pure background
 * color, a hairline top border, no rounding, no blur, no floating margins —
 * the same solid, no-blur treatment `AppTopbar` already uses. The previous
 * `.glass-strong` floating rounded pill (frosted, inset margins, drop shadow)
 * is gone; that "floating glass dock" look is reserved for an eventual real
 * native app shell, not the web/PWA chrome.
 *
 * Inactive tabs are plain, muted outline icons with a label; the ACTIVE tab
 * swaps to its solid glyph in the brand blue (`text-primary`) — a flat inline
 * color change, Facebook/Snapchat style. Only a couple of px of spring-
 * animated lift remain (see NavLift) — never a floating badge. The Create
 * button is the one deliberately different element: a permanently-raised
 * gradient circle. Destinations are this app's real ones. Every tab tap fires
 * the shared haptic + the soft nav "tap" tone.
 *
 * Perf: no idle animation anywhere in this bar — only the micro-lift spring
 * and PressIcon's tap spring ever animate, both input-driven. The bar sits
 * flush with the true bottom of the viewport; only the safe-area inset (the
 * home-indicator on notched/installed devices) pads it, never an artificial
 * gap on a plain browser tab.
 */
// Subtle "3D" depth on the glyph so it sits raised off the flat bar — the active
// tab glows in the brand hue, the inactive ones carry a barely-there emboss. Shared
// verbatim with the marketing nav (components/landing/mobile-app-nav.tsx) so both
// bars read as the same material.
const GLYPH_ACTIVE = "text-primary [filter:drop-shadow(0_2px_6px_rgba(79,70,229,0.5))]";
const GLYPH_INACTIVE = "text-muted-foreground [filter:drop-shadow(0_1px_1.5px_rgba(2,6,23,0.14))]";

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const mode = useAppMode();
  const { handle, avatarUrl } = useEntitlements();
  // Cached-first: shows the last-known unread count instantly, updates live via
  // the realtime inbox subscription (InboxRealtimeTracker). `revalidateOnFocus:
  // false` so an iOS back-swipe / app resume never refetches the inbox just to
  // repaint this badge — that blanket refetch was part of the "message page
  // reloads on swipe back" report (owner, 2026-07-21). This component is mounted
  // on every signed-in surface, so it's also what keeps INBOX_KEY frozen
  // app-wide (the cache's opt-out is reference-counted — see cache.ts).
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox, { revalidateOnFocus: false });
  const unread = inbox?.unread ?? 0;

  const profileHref = handle ? `/u/${handle}` : "/account";
  const profileActive = pathname.startsWith("/u/") || pathname.startsWith("/account");
  /*
    Surfaces where the CONTENT is full-bleed video and the nav should float over
    it rather than slab across it — see the note on the <nav> below. Only /reels
    today; a future full-screen player surface joins by adding its prefix here,
    which is the whole reason this is a named condition and not an inline test.
  */
  const immersive = pathname.startsWith("/reels");

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
    // Edge-to-edge, no floating margins — the bar itself owns the safe-area
    // padding (home-indicator inset on notched/installed devices; zero extra
    // gap on a plain browser tab) rather than sitting inset inside a wrapper.
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <nav
        aria-label="Primary"
        /*
          🔴 IMMERSIVE SURFACES GET A FLOATING BAR (owner, 2026-08-10: "i want
          the reels to go the safe area like tiktok and instagram and doesnt crop
          any content").

          The video was already full-bleed — the deck is `fixed inset-0` and runs
          to the physical bottom edge. What stopped it LOOKING that way was this
          bar: `bg-background` is fully opaque, so it painted a solid slab over
          the bottom of the picture. The reel reached the safe area and then had
          it covered up.

          That is precisely what TikTok and Instagram do differently. Their video
          runs to the physical edges and the tab bar FLOATS over it — a dark
          scrim, no border, white glyphs — so the frame is visible behind the
          controls instead of being cropped by them.

          So on `/reels` the bar keeps its size, its position and its safe-area
          padding (the CONTROLS still must not sit in the home-indicator strip —
          also the owner's instruction) and loses only its opacity: the hairline
          border goes, and the ground becomes a bottom-weighted gradient rather
          than a fill, so the glyphs stay legible on any frame while the video
          shows through.

          Nothing is cropped to achieve this. The picture is not scaled or
          shifted; it was always there, and this stops hiding it.

          Every other surface is untouched and keeps the native opaque tab bar —
          a translucent nav over a scrolling document is a legibility problem,
          which is exactly why it is scoped to the immersive route.
        */
        className={cn(
          "relative flex items-end justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.65rem)] pt-2.5",
          immersive
            ? [
                "bg-gradient-to-t from-black/85 via-black/55 to-transparent",
                /*
                  The INACTIVE glyphs and labels turn white here.

                  `text-muted-foreground` is a grey graded for a light page
                  background; over video it is close to invisible. Re-pointing it
                  at the descendants rather than threading an `immersive` prop
                  through every NavTab keeps this entire treatment in one place —
                  the tabs stay unaware they are on a dark surface, so no future
                  tab can be added and forget to handle it.

                  The ACTIVE tab keeps `text-primary`: it is the brand blue and it
                  reads clearly against a dark scrim, so the current destination
                  stays distinguishable rather than every tab going white.
                */
                "[&_.text-muted-foreground]:!text-white/75",
              ].join(" ")
            : "border-t border-border/60 bg-background",
        )}
      >
        {mode === "downloader" ? (
          <>
            {/* Downloader mode — downloads-focused destinations so the nav never
                pulls into Full Bleed (owner). Home is the signed-in download page;
                History is the shared history-only page. Profile is shared below. */}
            <NavTab label="Home" href="/downloads" icon={FrenzHomeOutline} activeIcon={FrenzHomeSolid} active={pathname === "/downloads"} onWarm={router.prefetch} />
            <NavTab label="Reels" href="/reels" icon={FrenzReelsOutline} activeIcon={FrenzReelsSolid} active={pathname.startsWith("/reels")} onWarm={router.prefetch} />
            <NavTab label="History" href="/history" icon={History} activeIcon={History} active={pathname.startsWith("/history")} onWarm={router.prefetch} />
            <NavTab label="Support" href="/support" icon={Headset} activeIcon={Headset} active={pathname.startsWith("/support")} onWarm={router.prefetch} />
          </>
        ) : (
          <>
            <NavTab label="Home" href="/home" icon={FrenzHomeOutline} activeIcon={FrenzHomeSolid} active={pathname === "/home"} onWarm={router.prefetch} />
            <NavTab label="Friends" href="/friends" icon={FrenzFriendsOutline} activeIcon={FrenzFriendsSolid} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />

            {/* Create — the signature gradient circle. Opens the action sheet (the
                owner's picked mockup). Full Bleed only; Downloader mode has no
                Create/Chats — those are the Full Bleed features. */}
            <PressIcon className="-mt-5 self-center">
              <button
                type="button"
                onClick={() => { haptic("selection"); playSound("tap"); setCreateOpen(true); }}
                aria-label="Create"
                aria-haspopup="dialog"
                aria-expanded={createOpen}
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

            <NavTab label="Chats" href="/messages" icon={FrenzInboxOutline} activeIcon={FrenzInboxSolid} active={pathname.startsWith("/messages")} badge={unread} onWarm={router.prefetch} />
          </>
        )}

        {/* Profile (avatar-in-circle) — active state is now a colored ring
            accent on the same tile, not a different fill entirely, matching
            the inline-color-change treatment the other tabs use.
            2026-07-15 (owner ask): the tab always showed the generic person
            glyph, never the visitor's own actual profile picture — swapped
            to the real `profiles.avatar_url` (same source `useEntitlements`
            already exposes for the topbar) when set, falling back to the
            plain icon only when there truly isn't one. */}
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
                  "flex h-7 w-7 items-center justify-center rounded-full transition",
                  // No avatar → the plain person glyph, no colored tile behind
                  // it (owner, 2026-07-16). It follows the same active/inactive
                  // contrast as every other tab rather than sitting on a blue
                  // block that made this one tab look permanently "selected".
                  avatarUrl
                    ? "overflow-hidden text-white"
                    : profileActive
                      ? "text-primary"
                      : "text-muted-foreground",
                  profileActive && avatarUrl && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FrenzPersonSolid className={cn("h-6 w-6", profileActive ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
                )}
              </span>
            </PressIcon>
          </NavLift>
          <span className={cn("text-[10px] font-semibold transition-colors", profileActive ? "text-primary" : "text-muted-foreground")}>Profile</span>
        </Link>
      </nav>

      {/* The "+" action sheet (owner's picked mockup). Rendered here rather
          than in AppOverlays because the "+" that opens it lives in this bar
          and nothing else can open it — so its state has no reason to be
          global. It portals to <body>, so this bar's own stacking/blur can't
          trap it. */}
      <CreateActionSheet open={createOpen} onClose={() => setCreateOpen(false)} />
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
  guard,
}: {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  activeIcon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  active: boolean;
  badge?: number;
  onWarm?: (href: string) => void;
  /** When set, intercepts the tap: prevents navigation and runs the guard instead
   *  (used to offer the Full Bleed switch for a gated Downloader-mode tab). */
  guard?: () => void;
}) {
  const Glyph = active ? ActiveIcon : Icon;
  return (
    <Link
      href={href}
      onPointerDown={guard ? undefined : () => onWarm?.(href)}
      onClick={(e) => {
        if (guard) {
          e.preventDefault();
          haptic("light");
          playSound("tap");
          guard();
          return;
        }
        haptic("light");
        playSound("tap");
      }}
      className="relative flex flex-col items-center gap-1 px-2 pb-0.5"
    >
      <NavLift active={active}>
        <PressIcon active={active} className="relative">
          <Glyph strokeWidth={2.1} className={cn("h-6 w-6 transition-colors", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
          {badge > 0 ? (
            <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
      <span className={cn("text-[10px] font-semibold transition-colors", active ? "text-primary" : "text-muted-foreground")}>{label}</span>
    </Link>
  );
}
