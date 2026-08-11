"use client";

import { IoCloudUploadOutline, IoSearchOutline } from "react-icons/io5";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { IconTile } from "@/components/icons/icon-tile";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/app-shell/notification-bell";
import { setTopbarHidden } from "@/features/app-shell/topbar-visibility";
import { useTopbarCenter } from "@/features/app-shell/topbar-slot";
import { UserMenu } from "@/features/auth/user-menu";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

export function AppTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  // The owner's Messages mockup starts straight at the big "Messages" title —
  // no global topbar above it on mobile. That page carries its own header
  // (compose + tools circles), so the topbar hides there below lg; every
  // other route keeps it. Thread pages already cover it with their own
  // full-screen overlay, so only the index needs this.
  const onMessagesIndex = pathname === "/messages";
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The feed lifts its For You/Following/Reels control up here (owner spec)
  // — every other page's search bar is untouched, since only the feed ever
  // populates this slot.
  const center = useTopbarCenter();

  // ⌘K / Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The topbar stays PINNED on scroll (owner, 2026-08-02: "make the top header
  // fixed even on scroll") — the earlier auto-hide-on-scroll-down is gone. It is
  // `sticky top-0`, so it already rides the top of the scroll container and
  // nothing translates it out of view any more. Broadcast a constant "visible"
  // so any far-away sticky element that keyed off the topbar's hidden state
  // stays put rather than compensating for a hide that never happens.
  useEffect(() => {
    setTopbarHidden(false);
    return () => setTopbarHidden(false);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : "/search");
  };

  return (
    <header
      className={cn(
        // pt safe-area: with viewport-fit=cover the installed app draws under
        // the status bar — the bar pads itself clear of the clock/battery
        // (zero in a normal browser tab, so nothing changes there).
        "sticky top-0 z-30 flex items-center gap-2 px-4 pt-[var(--frenz-safe-top)]",
        "h-[calc(4rem+var(--frenz-safe-top))]",
        // Owner correction (2026-07-13): the top nav must track the SYSTEM
        // theme like every other surface — white in light mode, blending
        // into the app's own dark background in dark mode ("the top edge
        // look full screen") — not a fixed colored gradient wash regardless
        // of theme. Full-width edge-to-edge on every route, including Home
        // (owner correction, same date: the earlier floating rounded card
        // with side margins is gone — "make the top nav width full, and no
        // border radius at the side edges... fix at the top 0"). Solid/opaque
        // `bg-background`, no blur (owner correction, same date: "make the
        // top nav background pure white and not blured transparent" — the
        // previous `bg-background/60 backdrop-blur-xl` frosted-glass look let
        // scrolled content show through instead of a clean solid bar).
        // 🔴 Stays `bg-background` (white) even on a canvas-grounded page such as
        // /downloads — owner, 2026-08-11: "let the download page top header and
        // safe area be white". A hook class briefly lived here so a `:has()` rule
        // could retint the bar; it and the rule are gone. See globals.css.
        "border-b border-border/20 bg-background",
        onMessagesIndex && "hidden lg:flex",
      )}
    >
      {/* Far-left: search + add friends — kept apart from the action cluster so
          the right side never gets crowded. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Mobile search entry (the search box is tablet+ only) */}
        <PressIcon className="relative sm:hidden">
          <Link
            href="/search"
            aria-label="Search"
            onClick={() => {
              haptic("light");
              playSound("tap");
            }}
            className="flex h-10 w-10 items-center justify-center"
          >
            <IconTile>
              <IoSearchOutline className="h-[20px] w-[20px]" />
            </IconTile>
          </Link>
        </PressIcon>
        {/* Add friends — single top-nav icon */}
        <span className="relative">
          <SuggestionsLauncher />
        </span>
      </div>

      {center ? (
        <>
          {/* A page-owned center slot (currently just the feed's tabs)
              replaces the search bar/spacer entirely — centered in the
              middle of the bar at every width. */}
          <div className="flex flex-1 items-center justify-center">{center}</div>
          {/* Desktop search fallback — the inline pill is off-screen while the
              slot is active, so ⌘K/search still needs a reachable entry point. */}
          <PressIcon className="hidden sm:inline-flex">
            <Link
            href="/search"
            aria-label="Search"
            onClick={() => {
              haptic("light");
              playSound("tap");
            }}
            className="flex h-10 w-10 items-center justify-center"
          >
              <IconTile>
                <IoSearchOutline className="h-[20px] w-[20px]" />
              </IconTile>
            </Link>
          </PressIcon>
        </>
      ) : (
        <>
          {/* Search — pill, Instagram/Snapchat style (desktop, fills the middle) */}
          <form onSubmit={submit} className="relative hidden max-w-xl flex-1 sm:block">
            <IoSearchOutline className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search videos, people, hashtags…"
              aria-label="Search"
              className="h-11 w-full rounded-full bg-secondary/50 pl-11 pr-12 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-2 focus:ring-primary/40"
            />
            <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:block">
              ⌘K
            </kbd>
          </form>

          {/* Mobile spacer — pushes the action cluster to the far right */}
          <div className="flex-1 sm:hidden" />
        </>
      )}

      {/* Right action cluster */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Create — goes straight to the dedicated Post surface (owner,
            2026-07-16: each create button opens its OWN create page; there is
            no shared composer to re-steer any more). */}
        <PressIcon className="hidden sm:inline-flex">
          <Link
            href="/create/post"
            onPointerDown={() => router.prefetch("/create/post")}
            aria-label="Create a post"
            title="Create"
            className="inline-flex h-11 w-11 items-center justify-center"
          >
            <IconTile>
              <IoCloudUploadOutline className="h-[21px] w-[21px]" />
            </IconTile>
          </Link>
        </PressIcon>

        {/* Notifications — mobile/tablet only (large screens use the sidebar
            Notifications item, so the top-right stays uncluttered). The
            mockup's other right-side circles (two-people, play) are the
            feed's own Following/Reels segments, rendered by FeedTopbarTabs
            in the center slot — adding separate Friends/Reels icons here
            duplicated them and pushed this bell off-screen. */}
        <span className="lg:hidden">
          <NotificationBell />
        </span>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        {/* Avatar menu — desktop/tablet; on mobile the Profile tab in the bottom nav covers this */}
        <div className="hidden sm:block">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
