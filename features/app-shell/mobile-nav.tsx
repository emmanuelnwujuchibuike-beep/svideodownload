"use client";

import { Headset, History } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useBottomAdBarPresent } from "@/lib/dom/bottom-ad-bar";
import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { useEffect, useRef } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { useAiGlassTier } from "@/features/ai/design/glass-tier";
import {
  FrenzEarnOutline,
  FrenzEarnSolid,
  FrenzFeedOutline,
  FrenzFeedSolid,
  FrenzHomeOutline,
  FrenzHomeSolid,
  FrenzInboxOutline,
  FrenzInboxSolid,
  FrenzPersonSolid,
} from "@/components/icons/frenz-icons";
import { GUEST_WARM_ROUTES } from "@/features/app-shell/warm-routes";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";
import { isSlowConnection } from "@/lib/pwa/use-network-status";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation — a FLOATING GLASS PILL (owner, 2026-10-09: "a genuinely
 * floating Instagram/WhatsApp-inspired glass bottom navigation with visible left
 * and right margins … do not turn it into a full-width bottom bar").
 *
 * This reverses the 2026-08 edge-to-edge opaque bar ("only native apps will have
 * glass floating nav"), on the owner's newer, explicit instruction:
 *
 *   · Centred, `calc(100% - 28px)` wide (14 px of page visible on each side),
 *     capped at 560 px, fixed `--frenz-nav-gap` above the bottom — low, just
 *     clear of the home indicator (~22 px up on an iPhone, 8 px with no inset;
 *     owner: "it shouldn't float much too high"). Centred by `inset-x-0 mx-auto`, not a
 *     transform, so the scroll-away transform below never fights the centring.
 *   · `.frenz-nav-glass` (globals.css): translucent white (dark glass in dark
 *     mode and over reels), a 12 px backdrop blur, a hairline border, one
 *     restrained shadow — with the `.ai-glass` fallback tiers (reduced blur on a
 *     constrained device, translucent without backdrop-filter support, solid for
 *     reduced transparency). No full-width backing anywhere behind it.
 *   · A fixed height (`--frenz-nav-height`) so the room every page reserves,
 *     `--frenz-nav-clearance`, is exact rather than estimated.
 *
 * Labels stay under every glyph (owner, 2026-10-09: "add description to the
 * landing bottom NAVs"). The ACTIVE tab swaps to its solid glyph in the brand
 * blue (`text-primary`) with a couple of px of CSS lift — no glow, no halo, no
 * pulse. Destinations are this app's real ones. Every tab tap fires the shared
 * haptic + the soft nav "tap" tone.
 *
 * Perf: nothing in this bar animates at rest — no blur, shadow or fill ever
 * transitions, and the old 15 s `attract-loop` pulse on the Feed tab is gone.
 * Only the tap-driven lift and PressIcon's press scale ever move.
 */
/*
  ── Bolder 3D (owner, 2026-08-16: "more 3D… more contrast… more darker…
  more lively") — the SHADOWS deepen here to match the marketing nav's,
  static and free exactly as before. The base COLOUR stays
  `text-muted-foreground`, unlike the marketing nav's darker slate: this
  file's immersive (Reels) variant below re-tints every inactive glyph white
  via a selector keyed on the literal class name
  `[&_.text-muted-foreground]:!text-white/75` (line ~213) — swapping the
  class here would silently stop that selector matching and un-white the
  Reels nav over video, which is a distinct, already-hard-won piece of UI
  (see its own extensive comment below) this pass has no reason to touch.
  The non-immersive bar below gets the darker lining/elevation instead,
  which reaches the same "more contrast, more premium" ask without moving
  a class every other selector in this file depends on.
*/
/*
  🔴 NO DROP-SHADOW (owner, 2026-08-30: "Remove this blue shadow from the feed
  button", with a screenshot of the glyph haloed in indigo).

  It was `drop-shadow(0 4px 10px rgba(79,70,229,0.7))` — a 70%-opacity indigo
  glow under whichever tab was active. At that opacity and blur it does not read
  as elevation, it reads as the icon bleeding colour onto the bar, and it was
  the loudest thing on an otherwise flat, solid nav.

  The active state is carried by `text-primary` alone now, which is the same
  signal every other surface in the app uses. A previous pass already removed a
  BLACK drop-shadow from this constant for the same reason; this removes the
  colour one it left behind.
*/
const GLYPH_ACTIVE = "text-primary";
// Black drop-shadow removed (owner, 2026-08-25) — the color base
// (`text-muted-foreground`) is untouched on purpose: the immersive Reels
// variant re-tints every inactive glyph white via a selector keyed on that
// literal class name (`[&_.text-muted-foreground]:!text-white/75`, ~line
// 213) — dropping the class itself would silently un-white the Reels nav.
const GLYPH_INACTIVE = "text-muted-foreground";

/*
  Five equal columns across the pill, each the pill's full height — so every tab
  is a full-height target, not just its glyph — with a visible keyboard focus
  ring inside the pill's curve.
*/
const TAB_CLASS =
  "relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[1.25rem] px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

/**
 * `marketing` is still accepted from the marketing layout but no longer changes the
 * tab set: since the Full Bleed merge (owner, 2026-10-09) there is one bar,
 * chosen only by whether the visitor is signed in.
 */
export function MobileNav({
  marketing: _marketing = false,
}: {
  marketing?: boolean;
}) {
  const pathname = usePathname();
  /*
    Scroll-away nav (owner, 2026-08-31: "i want the bottom nav in the landing
    pages and download page to hide when scrolling down").

    The surface is no longer named here. It is wherever a real docked ad bar
    exists to take the nav's place — see `hideForScroll` below. /home, /reels
    and the messaging surfaces mount no such bar, so they keep their nav
    exactly as before without needing to be listed.
  */
  const scrollDir = useScrollDirection();
  // Writes html[data-glass="reduced"] on a constrained device, which drops the
  // nav's blur (see `.frenz-nav-glass`). Once per mount; no timer, no listener.
  useAiGlassTier();
  /* Whether a real, filled ad bar is docked below — see bottom-ad-bar.ts. */
  const bottomAdBarPresent = useBottomAdBarPresent();
  const router = useRouter();
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

  /*
    🔴 `/profile` for a guest, not `/account` (owner, 2026-08-16: "i want it
    shared across all just like the previous bottom nav" — merging this nav
    with the marketing-only copy surfaced the discrepancy). `/account` is an
    (app)-group settings page with its own auth guard, so a signed-out
    visitor tapping Profile landed on a login redirect instead of the
    marketing doorway the OTHER nav correctly used. `/profile` is that
    doorway (app/(marketing)/profile).
  */
  const profileHref = handle ? `/u/${handle}` : "/profile";
  const profileActive = pathname.startsWith("/u/") || pathname.startsWith("/account") || pathname.startsWith("/profile");
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
  //
  // 🔴 `/feed` and `profileHref` warmed from HERE specifically (owner,
  // 2026-08-18: "i want the feed page start loading immediately the landing
  // page and download page opens... just like the history page"). This
  // component is what's mounted on both of those — the marketing nav and
  // `/downloads`' own bare `<MobileNav />` — so it's the one place a single
  // addition reaches both without duplicating the effect. Paired with each
  // route's own `loading.tsx` (feed/home/account all have one, mirroring
  // `home/loading.tsx`'s original): that gives the route a static Suspense
  // boundary to actually prefetch INTO — without it, this prefetch had
  // nothing to warm but the page's own inline (non-prefetchable) Suspense.
  //
  // `/account` (Settings) ADDED (owner, 2026-08-23: "feed page, profile page
  // and settings page... load immediately the Download page opens... like
  // the history page") — feed and profile were already here; settings was
  // the one signed-in destination this effect hadn't reached yet, even
  // though `account/loading.tsx` already existed for it to warm into.
  //
  // `/history` and `/studio/ai/history` ADDED (owner, 2026-09-14: "the history
  // pages still don't open instantly") — the tab warmed `/history` only on
  // pointer-down, which is too late on a phone that taps; the AI history had
  // no warm at all. Both have a loading.tsx to warm into.
  //
  // 🔴 GUESTS GET THE PUBLIC TABS ONLY (2026-10-05, measured on a production
  // build). The list below is for MEMBERS and is unchanged. A signed-out
  // visitor was warming all eight too: `/account` and `/studio/ai/history`
  // bounce straight to /login, and `/home`, `/friends`, `/messages` are
  // `private, no-store` server renders of member pages a guest never sees a
  // tab for — five server renders per idle signed-out page view, for nothing.
  // A guest now warms only the tabs a guest has: Feed, History, Profile.
  useEffect(() => {
    if (isSlowConnection()) return;
    const member = !!handle || hasAuthCookie();
    const routes = member
      ? ["/home", "/friends", "/messages", "/account", "/history", "/studio/ai/history", profileHref]
      : GUEST_WARM_ROUTES;
    const id = setTimeout(() => {
      for (const r of routes) router.prefetch(r);
    }, 400);
    return () => clearTimeout(id);
  }, [router, profileHref, handle]);

  // Publish the nav's real height (already includes the home-indicator
  // safe-area pad) as `--frenz-bottomnav-h`, so a fixed bar elsewhere (the
  // marketing pages' bottom ad, features/monetization/top-banner-ad.tsx) can
  // dock directly above it without hardcoding a height. Ported from the
  // marketing-only nav this component now replaces — see the module doc.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = navRef.current;
    const root = document.documentElement;
    if (!el) return;
    /*
      The FLOATING nav occupies its own height PLUS the gap under it, so that sum
      is what is published — a bar docking "above the nav" must clear the pill,
      not stop inside the gap. 0 when the nav is not displayed (lg and up).
    */
    const setH = () => {
      const h = el.offsetHeight;
      const gap = Number.parseFloat(getComputedStyle(el.parentElement ?? el).bottom) || 0;
      root.style.setProperty("--frenz-bottomnav-h", `${h ? Math.round(h + gap) : 0}px`);
    };
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(el);
    // The gap follows the safe-area inset, which changes on rotation.
    window.addEventListener("orientationchange", setH);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", setH);
      root.style.setProperty("--frenz-bottomnav-h", "0px");
    };
  }, []);

  /*
    🔴 THE NAV ONLY STEPS ASIDE FOR SOMETHING THAT IS ACTUALLY THERE
    (owner, 2026-08-31: "on landing and download page the bottom nav hides but
    no bottom banner shows").

    This was gated on the PATHNAME alone — `/` or `/downloads` — on the premise
    that the ad bar would rise into the space the nav vacated. Nothing checked
    whether it had. When the bar had no fill (no configured zone, or a
    configured one the network did not fill, which is most of the time) the
    navigation slid away and left a gap. The whole point of the choreography is
    that the two bars TRADE places; a trade with one participant is just losing
    the nav.

    So the condition is now the bar's own report of itself, and the route no
    longer comes into it. That also answers the other half of the same report —
    "other pages still doesnt hide the bottom nav" — correctly and by
    construction rather than by adding route names: any page that grows a real
    docked ad bar gets the choreography, and any page without one keeps its nav
    exactly where it is. Two facts that used to be derived separately are now
    one fact, read from one place.
  */
  const hideForScroll = bottomAdBarPresent && scrollDir === "down";

  return (
    /*
      The floating wrapper: inset 14 px from both edges, centred, capped at
      560 px, `--frenz-nav-gap` above the bottom. `pointer-events-none` on the
      wrapper and `auto` on the pill, so the strip of page beside and under the
      pill stays tappable.

      🔴 Hidden by TRANSFORM, never by unmounting or by height — it keeps
      publishing --frenz-bottomnav-h either way, so the docked ad bar can trade
      places with it against a stable number. The travel is the pill's own
      height plus its gap, so it leaves the screen completely.
    */
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-[var(--frenz-nav-gap)] z-40 mx-auto w-[calc(100%-1.75rem)] max-w-[560px] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden motion-reduce:transition-none",
        hideForScroll && "translate-y-[calc(100%+var(--frenz-nav-gap)+0.5rem)]",
      )}
    >
      <nav
        ref={navRef}
        aria-label="Primary"
        /*
          🔴 IMMERSIVE SURFACES (/reels) get the same pill in DARK glass whatever
          the theme, with the inactive glyphs and labels re-tinted white — the
          video runs to the physical edges and the pill floats over it, the way
          TikTok and Instagram draw it. Re-pointing `text-muted-foreground` at the
          descendants (rather than threading an `immersive` prop through every
          NavTab) keeps the treatment in one place; the ACTIVE tab keeps the
          brand blue, which reads on dark glass.

          The pill sits at most `--frenz-nav-clearance` from the bottom, which is
          below the reel scrubber (REEL_PROGRESS_BOTTOM in reel-viewer.tsx,
          4.75rem + the inset) — the two numbers are still a pair; move one and
          check the other.
        */
        className={cn(
          "frenz-nav-glass pointer-events-auto relative flex h-[var(--frenz-nav-height)] items-center justify-around rounded-[1.75rem] px-1.5",
          immersive && "frenz-nav-glass--immersive [&_.text-muted-foreground]:!text-white/75",
        )}
      >
        {/*
          🔴 ONE EXPERIENCE (owner, 2026-10-09: "remove the full bleed features … let
          there be only one experience which is the Download experience … the former
          full bleed bottom NAV should not be used anywhere"). One tab set, chosen only
          by whether someone is signed in:
            member  Home (/downloads) · Feed (/home, the complete feed) · History · Chats · Profile
            guest   Home (/) · Earn (/quests) · History · Support · Profile
          Every tab carries its label (owner: "add description to the landing bottom NAVs").
        */}
        <NavTab
          label="Home"
          href={handle ? "/downloads" : "/"}
          /* A member's "/" is a 307 to /downloads, and a followed redirect
             is a full HTML render (measured 2026-10-05). Until the handle
             is known, a member's Home tab does not prefetch "/" at all —
             same guard as the header logo. */
          prefetch={handle || !hasAuthCookie() ? undefined : false}
          icon={FrenzHomeOutline}
          activeIcon={FrenzHomeSolid}
          active={pathname === "/downloads" || (!handle && pathname === "/")}
          onWarm={router.prefetch}
        />
        {handle ? (
          /* The complete feed (posts and videos) lives at /home; the Feed tab is its door. */
          <NavTab
            label="Feed"
            href="/home"
            icon={FrenzFeedOutline}
            activeIcon={FrenzFeedSolid}
            active={pathname === "/home" || pathname.startsWith("/feed") || pathname.startsWith("/reels")}
            onWarm={router.prefetch}
          />
        ) : (
          /* Earn in Feed's place on the landing (owner, 2026-10-09) — the quests; the page itself asks a guest to sign in. */
          <NavTab label="Earn" href="/quests" icon={FrenzEarnOutline} activeIcon={FrenzEarnSolid} active={pathname.startsWith("/quests")} onWarm={router.prefetch} />
        )}
        <NavTab label="History" href="/history" icon={History} activeIcon={History} active={pathname.startsWith("/history")} onWarm={router.prefetch} />
        {/* Signed in: Chats in Support's place (owner, 2026-10-08). A guest keeps Support. */}
        {handle ? (
          <NavTab label="Chats" href="/messages" icon={FrenzInboxOutline} activeIcon={FrenzInboxSolid} active={pathname.startsWith("/messages")} badge={unread} onWarm={router.prefetch} />
        ) : (
          <NavTab label="Support" href="/support" icon={Headset} activeIcon={Headset} active={pathname.startsWith("/support")} onWarm={router.prefetch} />
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
          aria-label="Profile"
          className={TAB_CLASS}
        >
          <NavLift active={profileActive}>
            <PressIcon active={profileActive}>
              <span
                className={cn(
                  "flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full transition",
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
          <NavLabel active={profileActive}>Profile</NavLabel>
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
/*
  🔴 CSS, not framer-motion (owner, 2026-08-25: "remove navigation motion
  bottlenecks … bottom navigation must feel instant and native").

  This was a `motion.span` running a spring for a TWO-PIXEL lift. Measured
  before the change: framer's core is 39.3 kB gzipped in one chunk, and this
  component — mounted in `(app)/layout`, i.e. on the critical path of every
  signed-in navigation — was one of only three things in the shell importing
  it. A JS animation library evaluating a spring on every tab tap, for 2px, is
  precisely the "simple effect" §3 says belongs in CSS.

  A cubic-bezier over 2px is visually indistinguishable from a spring, and the
  active state now updates in the same frame as the tap instead of after a JS
  animation is scheduled.

  `motion-reduce:transition-none` keeps the accessibility behaviour the framer
  version had via `useReducedMotion` — the lift becomes instant rather than
  animated, which is what the setting asks for.

  NO `will-change` here, deliberately: §3 says not to add it without profiling
  evidence, and this codebase already has a scar from it — a permanent
  `will-change: transform` establishes a CONTAINING BLOCK for `position: fixed`
  descendants, which is documented at length on the page-transition classes in
  globals.css. A 2px transform does not need the hint.
*/
function NavLift({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-8 items-center justify-center transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        active ? "-translate-y-0.5" : "translate-y-0",
      )}
    >
      {children}
    </span>
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
  prefetch,
}: {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  activeIcon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  active: boolean;
  badge?: number;
  onWarm?: (href: string) => void;
  /** Passed to the Link; `false` suppresses the viewport prefetch. */
  prefetch?: boolean;
}) {
  const Glyph = active ? ActiveIcon : Icon;
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onPointerDown={() => onWarm?.(href)}
      onClick={() => {
        haptic("light");
        playSound("tap");
      }}
      className={TAB_CLASS}
    >
      <NavLift active={active}>
        <PressIcon active={active} className="relative">
          {/*
            🔴 THE BLUE HALO IS GONE (owner, 2026-08-30: "the bottom nav still
            glows, especially when the page just open").

            This was a `from-blue-500/60 to-violet-500/60 blur-md` disc pulsing
            behind the glyph on the `attract-loop` cycle — whose first beat lands
            about two seconds after mount, which is precisely why it read as
            "when the page just opens". Removing the active glyph's drop-shadow
            earlier the same day left this one behind, so the bar still glowed.

            The `attract-loop` pulse on the glyph went too (2026-10-09: "avoid
            … bouncing icons"): a 15 s loop that never stopped while the Feed tab
            was inactive, on a bar that is on screen on every page.
          */}
          <Glyph strokeWidth={2.1} className={cn("h-6 w-6 transition-colors", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
          {badge > 0 ? (
            <span className="absolute -right-3 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-slate-900">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
      <NavLabel active={active}>{label}</NavLabel>
    </Link>
  );
}

/** The tab's description under its glyph (owner, 2026-10-09: "add description to the landing bottom NAVs"). */
function NavLabel({ active, children }: { active: boolean; children: ReactNode }) {
  return <span className={cn("text-[10.5px] font-semibold leading-none", active ? GLYPH_ACTIVE : "text-muted-foreground")}>{children}</span>;
}
