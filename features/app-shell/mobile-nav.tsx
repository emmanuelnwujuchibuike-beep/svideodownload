"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Headset, History, LayoutGrid } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

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
 * 🔴 ICON-ONLY, no labels (owner, 2026-08-16, against the Facebook/Instagram
 * reference screenshots: "professional simple and clean… 3d and mid big").
 * Every tab used to carry a text label under its glyph; the reference bars
 * carry none, just bigger icons on a taller bar. Inactive tabs are plain,
 * muted outline icons; the ACTIVE tab swaps to its solid glyph in the brand
 * blue (`text-primary`) — a flat inline color change, Facebook/Snapchat
 * style, which is now the ONLY way a tab reads as selected (see `aria-label`
 * on each tab for the accessible name the removed visible label used to be).
 * Only a couple of px of spring-animated lift remain (see NavLift) — never a
 * floating badge. Destinations are this app's real ones. Every tab tap fires
 * the shared haptic + the soft nav "tap" tone.
 *
 * The Create "+" that used to live here as a permanently-raised gradient
 * circle is gone from this bar entirely — moved to `AppTopbar`, non-round,
 * next to search (owner: "move the + button to top… don't make the plus
 * button round"). Full Bleed's five tabs are now Home / Friends / Reels /
 * Chats / Profile — Reels, previously only reachable from the top feed
 * segmented control, takes the slot Create vacated.
 *
 * Perf: no idle animation anywhere in this bar — only the micro-lift spring
 * and PressIcon's tap spring ever animate, both input-driven. The bar sits
 * flush with the true bottom of the viewport; only the safe-area inset (the
 * home-indicator on notched/installed devices) pads it, never an artificial
 * gap on a plain browser tab.
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
const GLYPH_ACTIVE = "text-primary [filter:drop-shadow(0_4px_10px_rgba(79,70,229,0.7))]";
const GLYPH_INACTIVE = "text-muted-foreground [filter:drop-shadow(0_3px_5px_rgba(2,6,23,0.3))]";

/**
 * Warms the reels viewer's chunk ahead of the actual tap (owner, 2026-08-16:
 * "reels loads on click, it suppose to warm up and prefetch before it being
 * clicked"). The SAME dynamic import `next/dynamic` uses in
 * features/feed/smart-feed.tsx's `preloadReelsFeed` — dynamic imports are
 * memoized by the runtime, so calling it here too costs nothing extra once
 * it's already resolved. This used to fire from the Reels segmented-control
 * tab in the top feed bar (`onReelsPreload`); when Reels moved to the
 * bottom nav (see the module doc above) that specific warm-up trigger was
 * left behind — mount-idle preloading still ran, but the LAST-MOMENT one
 * right before a tap didn't. `router.prefetch` alone doesn't cover it: that
 * warms the `/reels` ROUTE, not this dynamically-imported chunk.
 */
function warmReels() {
  void import("@/features/reels/reels-feed");
}

export function MobileNav({
  /*
    🔴 MARKETING PAGES ALWAYS SHOW FEED, NEVER REELS (owner, 2026-08-18,
    resolving a direct conflict with the 2026-08-16 "tab set depends only on
    mode, never on route" rule — surfaced and confirmed via AskUserQuestion
    before making this change): landing and the SEO downloader pages kept
    disagreeing about whether this slot showed Reels or Feed, because which
    branch rendered depended on the VIEWER's own `mode` cookie — a signed-in
    visitor happening to carry `mode=full` hit the OTHER branch entirely (the
    Full Bleed 5-tab set below, which has no Feed option at all and always
    shows Reels). `marketing` forces the simple 4-tab set with Feed in this
    slot unconditionally, so every marketing-page visitor sees the identical
    bar regardless of sign-in state or mode — Reels moves to the page's own
    top header instead (see AppTopbar's `onFeedIndex` handling). The actual
    signed-in app shell (home/friends/messages/etc.) is untouched — this only
    ever applies where `MobileAppNav` (the marketing wrapper) renders.
  */
  marketing = false,
}: {
  marketing?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mode = useAppMode();
  const { handle, avatarUrl } = useEntitlements();
  /*
    🔴 `/downloads` ITSELF NEEDS THIS TOO (owner, repeated: "the download page
    still shows the reels button in the bottom nav" — kept recurring even
    after the `marketing` fix above shipped). Root cause: `marketing` is only
    ever passed by `MobileAppNav`, which `(marketing)/layout.tsx` renders —
    the PUBLIC landing/SEO pages. `/downloads` (the signed-in Downloader home)
    lives under the `(app)` route group instead, whose layout mounts a bare
    `<MobileNav />` with no prop at all, so it was STILL falling through to
    the mode-dependent branch below — a signed-in visitor with `mode=full`
    hit the always-Reels Full Bleed tab set right here, same as marketing
    pages did before the fix. `/downloads` is the Downloader product's own
    home, the same product surface as the marketing pages just for a
    signed-in visitor, so it gets the identical forced treatment — computed
    from `pathname` here rather than threading a new prop through
    `(app)/layout.tsx`, since every OTHER page that layout renders (home,
    friends, messages, reels itself) must keep the real mode-dependent
    behavior untouched.

    🔴 `/feed` NEEDS IT TOO, FOR THE SAME REASON (owner: "when i click feed
    button in the download page, it enters the feed page but then the feed
    button change back to the reels button"). `/feed` is ALSO under `(app)`,
    so a signed-in visitor landing there fell straight out of `forceFeedTab`
    the instant the URL changed — the very tab they just tapped flipped to
    "Reels" under their thumb. Showing "Reels" while already ON the Feed page
    never made sense anyway; the whole point of this tab is "you are here".
  */
  const forceFeedTab = marketing || pathname === "/downloads" || pathname.startsWith("/feed");
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
  /*
    🔴 Full Bleed requires being SIGNED IN, not just the mode cookie (owner,
    2026-08-16: "the home button in the landing page is leading to the feed
    home and requiring a sign in").

    This component used to be mounted only inside the signed-in (app) shell,
    where reaching a Full-Bleed-mode page already implied a session existed.
    Now that it's also the marketing nav (see the merge note on `MobileAppNav`
    above), that assumption breaks: a signed-OUT visitor can still carry
    `mode=full` in their cookie (set on an earlier visit, or never cleared on
    sign-out), and `mode === "full"` alone would then render the Full Bleed
    tab set — Home pointing at `/home`, which requires a session and bounced
    them to login. Gating on `handle` too means a guest always sees the
    Downloader set regardless of what the mode cookie says.
  */
  const fullBleedActive = !forceFeedTab && mode === "full" && !!handle;

  // Warm the primary destinations once so the FIRST tap opens instantly — dynamic
  // routes (Messages/Friends) otherwise fetch on first navigation, which felt like
  // "tap twice before it opens". Runs after mount so it never blocks first paint.
  // Skipped entirely on data-saver/2G — this fires unconditionally regardless
  // of whether the user ever taps those tabs, unlike the hover/press-triggered
  // prefetches below (onWarm/onPointerDown), which stay on: those only spend
  // bandwidth once the user has already shown real intent to navigate there.
  //
  // 🔴 `/feed` warmed from HERE specifically (owner, 2026-08-18: "i want the
  // feed page start loading immediately the landing page and download page
  // opens... just like the history page"). This component is what's mounted
  // on both of those — the marketing nav and `/downloads`' own bare
  // `<MobileNav />` — so it's the one place a single addition reaches both
  // without duplicating the effect. Paired with the new `feed/loading.tsx`
  // (mirroring `home/loading.tsx`): that gives the route a static Suspense
  // boundary to actually prefetch INTO — without it, this prefetch had
  // nothing to warm but the page's own inline (non-prefetchable) Suspense.
  useEffect(() => {
    if (isSlowConnection()) return;
    const id = setTimeout(() => {
      for (const r of ["/home", "/friends", "/messages", "/feed", profileHref]) router.prefetch(r);
    }, 400);
    return () => clearTimeout(id);
  }, [router, profileHref]);

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
    // Edge-to-edge, no floating margins — the bar itself owns the safe-area
    // padding (home-indicator inset on notched/installed devices; zero extra
    // gap on a plain browser tab) rather than sitting inset inside a wrapper.
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <nav
        ref={navRef}
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
          // Taller + no label row (owner: "mid big") — a bit more top/bottom
          // breathing room than the label version needed, since the icon is
          // now the whole tab rather than sharing the row with text under it.
          "relative flex items-center justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.85rem)] pt-3.5",
          immersive
            ? [
                /*
                  🔴 THE DARK GROUND HAS TO REACH ABOVE THE GLYPHS (owner,
                  2026-08-10: "the bottom nav didnt cover the icon properly in
                  the reels, i want the dark section to go upper to cover the
                  bottom nav icons professionally").

                  The first version put `from-black/85 via-black/55 to-transparent`
                  on the nav BOX. The box is only ~76px tall and the icons start
                  10px below its top edge, so the glyphs were sitting in the part
                  of the gradient that had already faded to nearly nothing —
                  white icons on raw video, which is the "didn't cover it
                  properly".

                  Two layers fix it, and they do different jobs:

                   • THE NAV ITSELF is a near-solid dark ground (95%→75%), so
                     every glyph and label in the bar sits on a surface with
                     guaranteed contrast rather than on whatever frame is
                     playing. This is what TikTok and Instagram do — their tab
                     bar over a reel is effectively black, not a wash.

                   • `before:` EXTENDS 2rem ABOVE the bar and feathers out to
                     transparent, so the dark ground arrives gradually instead
                     of as a hard horizontal seam across the picture. That
                     feather is the difference between "a black slab" and the
                     professional look asked for.

                  🔴 2rem and not more, deliberately. This wrapper is `z-40` and
                  the reel deck is `z-30`, so anything painted here is painted
                  OVER the reel's own chrome. The reel's bottom stack
                  (REEL_PROGRESS_BOTTOM in reel-viewer.tsx) puts the scrubber at
                  4.75rem — flush with this bar's own top edge, the closest it
                  can sit without the bar itself starting to cover it (owner,
                  2026-08-16, twice: "close to the bottom NAV just like tiktok",
                  then "should come down more"). That's the feather's actual
                  job: it exists so content sitting over it stays legible, not
                  so content stays clear of it entirely. The two numbers are
                  still a pair; move one and check the other.

                  `before:pointer-events-none` is load-bearing for the same
                  z-order reason: a pseudo-element is part of its originating
                  element for hit-testing, so without it this strip would sit
                  over the video and silently swallow every tap-to-pause and
                  every swipe that started in it.
                */
                /* 🔴 /90 and not /88: this project's Tailwind opacity scale has
                   no 88, so `via-black/88` compiled to NOTHING and the middle
                   stop silently vanished (verified in the built CSS — the class
                   had no rule at all, and the computed gradient came back with
                   two stops). Same family of silent failure as the `z-60` that
                   emitted nothing. Check the BUILT CSS, not the source. */
                "bg-gradient-to-t from-black/95 via-black/90 to-black/75",
                "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8",
                "before:bg-gradient-to-t before:from-black/75 before:to-transparent",
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
            : // Darker lining + a static elevation shadow, matching the
              // marketing nav's own strengthening — see its comment. Left
              // OUT of the immersive branch above on purpose: that bar is
              // already a deliberately near-black gradient over video, where
              // a border and an upward shadow would have nothing to add.
              "border-t border-border bg-background shadow-[0_-4px_16px_-4px_rgba(2,6,23,0.12)] dark:shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.4)]",
        )}
      >
        {!fullBleedActive ? (
          <>
            {/*
              🔴 REVERSED (owner, 2026-08-16: "when i click on reels on the
              feed page it switches the bottom nav to the landing/downloader
              mode bottom nav, it shouldnt change bottom nav wherever the
              reels button was clicked").

              This used to be `mode === "downloader" || immersive` —
              `immersive` (on /reels) forced the Downloader set on EVERY
              visitor there, including a genuine Full Bleed member, per an
              earlier, opposite instruction ("the reels from the landing page
              and signed page suppose to be the same"). That owner has now
              reversed it: which SET of tabs shows should depend only on the
              viewer's actual mode, never on which route they're standing on.
              `immersive` still exists below — it now only changes how the
              bar LOOKS (floating, dark, white glyphs) while on /reels, not
              which destinations it offers.
            */}
            {/* `/home` is an ALIAS for this page in Downloader mode — middleware
                rewrites it rather than redirecting, so the PWA's start_url costs
                no extra round-trip. Without this the Home tab sat dark on the
                one screen every cold launch lands on.

                🔴 `/downloads` ONLY when signed in (owner, 2026-08-16: "the
                landing page home button still tries to open the downloader
                page instead of the landing page"). The old marketing-only
                nav got this right (`homeHref = signedIn ? "/downloads" :
                "/"`) and it was lost in the merge — `/downloads` has no auth
                guard, so it isn't WRONG for a guest, it's just a different
                page than the marketing landing, and Home on the marketing
                site has to mean the landing page for a visitor who never
                signed in. */}
            <NavTab
              label="Home"
              href={handle ? "/downloads" : "/"}
              icon={FrenzHomeOutline}
              activeIcon={FrenzHomeSolid}
              active={pathname === "/downloads" || pathname === "/home" || (!handle && pathname === "/")}
              onWarm={router.prefetch}
            />
            {/*
              🔴 ALWAYS FEED HERE, NEVER A PATHNAME ALLOWLIST (owner,
              2026-08-18: "when i enter signed in profile page, the feed
              button turns to the reels button" — the FOURTH page to trip
              this same bug class after /downloads, /feed itself, and
              marketing pages). This used to be `!forceFeedTab && handle ?
              Reels : Feed`, which reads as "genuine full-bleed users keep
              Reels here" but can never actually do that: this whole branch
              only renders when `fullBleedActive` is false, and
              `fullBleedActive` is `!forceFeedTab && mode === "full" &&
              !!handle` — so `mode === "full"` being true here would already
              imply `forceFeedTab` is true too (contradicting the `!forceFeedTab`
              this ternary also required), making the Reels case dead for
              every ACTUAL full-mode user. The only visitor who ever hit it
              was a signed-in DOWNLOADER-mode user on any page outside the
              `forceFeedTab` allowlist — exactly the profile-page report,
              and every allowlist entry before it. A genuine full-bleed
              session never reaches this branch at all (see `fullBleedActive`
              below); it gets its real Reels tab from the OTHER branch,
              unchanged. So within this branch the answer is simply always
              Feed — no pathname list to keep extending as new pages surface
              the same gap.
            */}
            <NavTab label="Feed" href="/feed" icon={LayoutGrid} activeIcon={LayoutGrid} active={pathname.startsWith("/feed")} onWarm={router.prefetch} />
            <NavTab label="History" href="/history" icon={History} activeIcon={History} active={pathname.startsWith("/history")} onWarm={router.prefetch} />
            <NavTab label="Support" href="/support" icon={Headset} activeIcon={Headset} active={pathname.startsWith("/support")} onWarm={router.prefetch} />
          </>
        ) : (
          <>
            <NavTab label="Home" href="/home" icon={FrenzHomeOutline} activeIcon={FrenzHomeSolid} active={pathname === "/home"} onWarm={router.prefetch} />
            <NavTab label="Friends" href="/friends" icon={FrenzFriendsOutline} activeIcon={FrenzFriendsSolid} active={pathname.startsWith("/friends")} onWarm={router.prefetch} />
            {/* Reels — takes the middle slot Create used to occupy (owner,
                2026-08-16: "move the reel button at the top to bottom in full
                bleed"). It used to be reachable only from the top feed's
                segmented control (FeedTopbarTabs); that entry is removed in
                favor of this one, so there is exactly one Reels affordance. */}
            <NavTab label="Reels" href="/reels" icon={FrenzReelsOutline} activeIcon={FrenzReelsSolid} active={pathname.startsWith("/reels")} onWarm={(href) => { router.prefetch(href); warmReels(); }} />
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
          aria-label="Profile"
          className="relative flex items-center justify-center px-3 py-1"
        >
          <NavLift active={profileActive}>
            <PressIcon active={profileActive}>
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full transition",
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
                  <FrenzPersonSolid className={cn("h-7 w-7", profileActive ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
                )}
              </span>
            </PressIcon>
          </NavLift>
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
      className="relative flex h-9 w-9 items-center justify-center"
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
      aria-label={label}
      aria-current={active ? "page" : undefined}
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
      className="relative flex items-center justify-center px-3 py-1"
    >
      <NavLift active={active}>
        <PressIcon active={active} className="relative">
          <Glyph strokeWidth={2.1} className={cn("h-7 w-7 transition-colors", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
          {badge > 0 ? (
            <span className="absolute -right-3 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-card">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </PressIcon>
      </NavLift>
    </Link>
  );
}
