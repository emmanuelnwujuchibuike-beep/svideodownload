"use client";

import { ArrowRight, Crown, Fingerprint, LogOut, UserCircle, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
import { IconTile } from "@/components/icons/icon-tile";
import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { useUser } from "@/features/auth/use-user";
import { UserMenu } from "@/features/auth/user-menu";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { SearchTrigger, SearchTriggerIcon } from "@/features/navigation/search-trigger";
import { DESTINATIONS } from "@/lib/navigation/registry";
import type { Destination } from "@/lib/navigation/types";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getPrimaryPages } from "@/lib/seo/seo-pages";
import { cn } from "@/lib/utils";

/**
 * Marketing nav, per `public/main landing page.jpg`.
 *
 * Every entry resolves to a route that exists — the mockup's "Products" points at
 * the ecosystem grid on `/` rather than a `/products` page nobody has built, and
 * "Support" at the real contact route. Shipping a nav item that 404s is the same
 * class of defect the Reality Ledger exists to catch, just in the chrome instead
 * of the copy.
 */
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/#products", label: "Products" },
  { href: "/#download", label: "Download" },
  { href: "/pricing", label: "Pricing" },
  /*
    Academy sits in the top nav rather than only in the footer. It is the deepest
    content on the site and the hub the ~148 generated downloader pages link into,
    so footer-only placement would leave it effectively unreachable by browsing —
    which is exactly what happened when it first shipped.

    Blog moves to the footer to keep this row from overflowing on narrow desktop
    widths; it remains linked there and in the sitemap.
  */
  { href: "/academy", label: "Academy" },
  { href: "/contact", label: "Support" },
];

/**
 * The mobile menu's structure, as ordered groups of registry ids.
 *
 * Ordered by what someone needs first: what the app DOES, then what they can make,
 * then their own stuff, then reference material.
 *
 * Ids only — labels, icons, hrefs and access rules all come from the navigation
 * registry, so this stays a layout decision and never becomes a second source of
 * truth that can disagree with the command palette.
 */
/*
  Groups are explicit id lists rather than a filter over the registry, so
  registering a destination is NOT enough to make it appear here. That caught me
  out: Academy, Trust Center and Glossary shipped as real, prerendered routes that
  were unreachable by browsing on any device, because nothing linked to them.

  "Learn" and "Help & trust" are separate groups because they answer different
  questions. Someone browsing wants the Academy; someone mid-problem wants to
  delete an account or block a person, and burying that under a heading called
  "Learn more" is how trust content goes unread.
*/
const MENU_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Discover", ids: ["home", "explore", "reels", "search"] },
  { title: "Create", ids: ["create-post", "create-reel", "create-story"] },
  { title: "Your stuff", ids: ["downloads", "saved", "messages", "friends", "notifications"] },
  { title: "Learn", ids: ["academy", "learn", "glossary", "blog"] },
  { title: "Help & trust", ids: ["trust", "contact", "developers", "pricing"] },
];

const DOWNLOADERS = getPrimaryPages();

/**
 * `social` hides the mobile hamburger + drawer: on in-app social surfaces
 * (profiles, posts) the bottom MobileNav already owns navigation, so the
 * marketing menu in the top-right is redundant and out of place there.
 *
 * `desktopHidden` hides the whole header on lg+ — used on profile pages where the
 * app shell (left sidebar + top bar) owns desktop nav, while this bar still
 * provides the mobile top bar.
 */
export function SiteHeader({ social = false, desktopHidden = false }: { social?: boolean; desktopHidden?: boolean }) {
  const [open, setOpen] = useState(false);
  /**
   * Slide state, kept separate from mount state.
   *
   * `open` decides whether the sheet is in the DOM; `shown` drives the transform.
   * A panel mounted already at its final position has nothing to animate FROM, so
   * it would just appear — flipping `shown` one frame after mount gives the browser
   * a start and an end to interpolate. On close we reverse `shown` first and unmount
   * after the transition, otherwise the sheet vanishes instead of sliding out.
   */
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  /**
   * Pending unmount from a close that is still animating. Held so a tap during
   * the slide-out can cancel it and slide the sheet back in.
   */
  const closeTimer = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    setShown(false);
    // Matches the 300ms transition on the panel; unmounting sooner cuts it short.
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 300);
  }, []);

  /**
   * Opening has two cases, and conflating them is a real bug rather than a nicety.
   *
   * If a close is still animating the sheet is STILL MOUNTED, so `setOpen(true)`
   * is a no-op — `open` never changes, the rAF effect above never re-runs, and the
   * menu would stay off-screen while the button claimed it was open. Cancelling the
   * pending unmount and flipping `shown` slides it straight back in.
   */
  const openMenu = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
      setShown(true);
      return;
    }
    setOpen(true); // fresh mount — the rAF effect gives it a frame to animate from
  }, []);

  // Never leave a timer to fire against an unmounted component.
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  // Escape closes, and the page behind is scroll-locked while the sheet covers it.
  // `overflowY` only — the convention here, because locking `overflow` outright
  // also kills horizontal clipping and shifts the layout.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const previous = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  const { user, enabled } = useUser();
  const { handle, plan } = useEntitlements();
  const { showAds, ready } = useShowAds();
  const isPremium = ready && !showAds;

  return (
    <>
    <header className={cn("fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)] backdrop-blur-xl", desktopHidden && "lg:hidden", social ? "border-b border-border/20 bg-background/60" : "border-b border-border/40 bg-background/85 supports-[backdrop-filter]:bg-background/70")}>
      <div className="container flex h-16 items-center justify-between">
        {/* Brand — hidden on mobile social surfaces (plain, full-bleed top bar) */}
        <Link href="/" className={cn("items-center", social ? "hidden lg:flex" : "flex")} onClick={() => setOpen(false)}>
          <FrenzWordmark size={32} priority />
        </Link>

        {/* Desktop nav — only at lg+; iPad-portrait (md) uses the roomy drawer so
            the bar never gets cramped. */}
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative transition-colors hover:text-foreground after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all hover:after:w-full"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Desktop right */}
        <div className="hidden items-center gap-3 lg:flex">
          {/*
            "Go Pro" is shown only to people who are SIGNED IN and not premium.

            The landing mockup's header carries exactly one gradient CTA —
            "Launch App" (rendered by UserMenu for signed-out visitors). Showing
            an amber "Go Pro" beside it gave a first-time visitor two competing
            gradient buttons and asked them to buy a subscription before they had
            an account, which is the wrong order: the download is the acquisition
            event, and the upgrade ask only lands once there is something to
            upgrade. Nothing is lost — Go Pro stays in the mobile menu, on
            /pricing, and here for signed-in free users, where it is the right ask.
          */}
          {user && !isPremium && (
            <Link
              href="/pricing"
              className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition-all hover:shadow-amber-500/40 hover:shadow-lg active:scale-[0.98]"
            >
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Crown className="h-4 w-4" /> Go Pro
            </Link>
          )}
          <SearchTrigger className="w-48" />
          <ThemeToggle />
          <UserMenu />
        </div>

        {/* Mobile right — search then menu, hidden on social surfaces (the bottom
            nav owns navigation there). */}
        {social ? null : (
          <div className="flex items-center gap-0.5 lg:hidden">
            <SearchTriggerIcon />
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              // Keyed off `shown`, not `open`: mid-slide-out the sheet is still
              // mounted, and keying off `open` would try to close an already
              // closing menu instead of bringing it back.
              onClick={() => {
                if (shown) closeMenu();
                else openMenu();
              }}
              className="inline-flex h-10 w-10 items-center justify-center"
            >
              <IconTile>
                {/*
                  A custom mark rather than the default hamburger (owner: "change
                  the menu toggle icon to something more unique"): three
                  right-aligned bars of DIFFERENT widths, which reads as a
                  considered brand mark instead of a generic control — and folds
                  into an X when open.

                  Spans rather than an icon component so each bar animates
                  independently, on transform and opacity only.
                */}
                {/*
                  The bars follow `shown`, NOT `open`.

                  `open` is mount state: on close it stays true for the 300ms the
                  sheet takes to slide out, so an X-driven-by-`open` sat as an X
                  for the whole animation and only snapped back to bars once the
                  panel unmounted. That reads as a laggy, unresponsive control —
                  the tap appears to do nothing for a third of a second.

                  `shown` is the visual/intent state and flips the instant the
                  user taps, so the mark morphs back to bars in step with the
                  panel sliding away, which is what makes the control feel
                  immediate. ARIA below deliberately stays on `open`, because the
                  sheet really is still present and focusable until it unmounts.
                */}
                <span className="relative flex h-5 w-5 flex-col items-end justify-center gap-[3.5px]">
                  <span
                    className={cn(
                      "h-[2px] rounded-full bg-current transition-all duration-300",
                      shown ? "w-5 translate-y-[5.5px] rotate-45" : "w-5",
                    )}
                  />
                  <span
                    className={cn(
                      "h-[2px] rounded-full bg-current transition-all duration-300",
                      shown ? "w-0 opacity-0" : "w-2.5 opacity-100",
                    )}
                  />
                  <span
                    className={cn(
                      "h-[2px] rounded-full bg-current transition-all duration-300",
                      shown ? "w-5 -translate-y-[5.5px] -rotate-45" : "w-3.5",
                    )}
                  />
                </span>
              </IconTile>
            </button>
          </div>
        )}
      </div>
      </header>

      {/*
        Mobile menu — a right-side sheet that SLIDES IN (owner: "the menu should
        also open with a slide right just like claude ai ios app").

        `open` controls mount; `shown` drives the transform and flips one frame
        later, so the panel exists at its off-screen start position before the
        transition begins. Without that gap the browser has nothing to animate
        FROM and the sheet simply appears. Closing reverses `shown` first and
        unmounts after the transition, so it slides out instead of vanishing.

        Contents come from the NAVIGATION REGISTRY rather than a hand-kept list, so
        this menu and the command palette cannot disagree about what exists — the
        payoff for building that registry first.
      */}
      {open && !social && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className={cn(
              "fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
              shown ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className={cn(
              "fixed bottom-0 right-0 top-0 z-50 flex w-[88%] min-w-[18rem] max-w-sm flex-col border-l border-border/60 bg-background shadow-2xl lg:hidden",
              "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              shown ? "translate-x-0" : "translate-x-full",
            )}
          >
            {/* The sheet covers the page, so it carries its own brand and close
                control rather than relying on the bar behind it. */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
              <FrenzWordmark size={28} />
              <button
                type="button"
                onClick={closeMenu}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
              {/* Search lives IN the menu (owner: "everything need to be in the
                  mobile menu and organised even the search"). A keyboard shortcut
                  is an accelerator for people with a keyboard; on a phone the only
                  discoverable search is one you can see and tap. */}
              <SearchTrigger className="w-full" />

              {!isPremium && (
                <Link
                  href="/pricing"
                  onClick={closeMenu}
                  className="group relative mt-3 flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-500/25"
                >
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  <Crown className="h-4 w-4" /> Go Pro — remove ads
                </Link>
              )}

              {/* Grouped in the order someone actually needs them. The previous
                  menu was one flat list with eleven platform rows through the
                  middle, which buried everything under them. */}
              {MENU_GROUPS.map((group) => {
                const items = group.ids
                  .map((id) => DESTINATIONS.find((d) => d.id === id))
                  .filter((d): d is Destination => Boolean(d))
                  .filter((d) => (d.requiresAuth ? !!user : true))
                  .filter((d) => d.canAccess({ plan: plan ?? "free", isAdmin: false }));

                if (items.length === 0) return null;

                return (
                  <div key={group.title} className="mt-6">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      {group.title}
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {items.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={d.href}
                            onClick={closeMenu}
                            className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 py-2 text-[15px] font-medium transition-colors hover:bg-secondary"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                              <d.icon className="h-4 w-4" />
                            </span>
                            {d.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {/* Platforms as a compact grid instead of eleven full-width rows. */}
              <div className="mt-6">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                  Download from
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {DOWNLOADERS.slice(0, 8).map((d) => {
                    const platform = PLATFORMS[d.platformId];
                    const Icon = BRAND_ICONS[d.platformId];
                    return (
                      <Link
                        key={d.slug}
                        href={`/${d.slug}`}
                        onClick={closeMenu}
                        className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 p-2 transition-colors hover:bg-secondary"
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                            platform.accent,
                          )}
                        >
                          {Icon ? <Icon className="h-4 w-4" /> : null}
                        </span>
                        <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                          {platform.name}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between rounded-2xl border border-border/60 px-3 py-2">
                <span className="text-sm font-medium text-muted-foreground">Appearance</span>
                <ThemeToggle />
              </div>

              {enabled && user ? (
                <div className="mt-3 space-y-0.5">
                  <Link
                    href={handle ? `/u/${handle}` : "/account#profile"}
                    onClick={closeMenu}
                    className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 py-2 text-[15px] font-medium transition-colors hover:bg-secondary"
                  >
                    <ModuleIconBadge icon={UserCircle} /> {handle ? "My profile" : "Set up profile"}
                  </Link>
                  <form action="/api/auth/signout" method="post">
                    <button
                      type="submit"
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[15px] font-medium text-rose-600 transition-colors hover:bg-secondary dark:text-rose-400"
                    >
                      <ModuleIconBadge icon={LogOut} /> Sign out
                    </button>
                  </form>
                </div>
              ) : null}

              {enabled && !user ? (
                /*
                  Mirrors UserMenu's desktop CTA exactly — same gradient, glow,
                  sheen and Fingerprint mark — differing only in being full-width.
                  One control, one treatment, on every viewport.
                */
                <Link
                  href="/login?next=/account"
                  onClick={closeMenu}
                  className="group relative mt-4 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-violet-600 to-purple-600 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 active:scale-[0.97]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-500 opacity-40 blur-md motion-safe:animate-pulse"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <Fingerprint className="h-5 w-5" />
                  Launch App
                  <ArrowRight className="h-5 w-5" />
                </Link>
              ) : null}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
