"use client";

import { IoCloudUploadOutline, IoSearchOutline } from "react-icons/io5";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { IconTile } from "@/components/icons/icon-tile";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/app-shell/notification-bell";
import { isTopbarLocked, setTopbarHidden, useTopbarLocked } from "@/features/app-shell/topbar-visibility";
import { useTopbarCenter } from "@/features/app-shell/topbar-slot";
import { openUpload } from "@/features/create/upload-store";
import { UserMenu } from "@/features/auth/user-menu";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

export function AppTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState(false);
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

  // Auto-hide on scroll-down, reveal on scroll-up (mobile only — forced back
  // visible on large screens via the `lg:` override on the header below).
  // Direction-based (not position-based) so it reacts instantly to intent,
  // with a small dead zone near the top so it never hides before there's
  // anywhere meaningful to scroll. Pages that lock the topbar (the feed, so
  // its sticky tab bar never slides) keep it pinned visible.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (isTopbarLocked() || y < 72) setHidden(false);
        else if (delta > 4) setHidden(true);
        else if (delta < -4) setHidden(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // If a page engages the lock while the bar is already hidden, surface it.
  const locked = useTopbarLocked();
  useEffect(() => {
    if (locked) setHidden(false);
  }, [locked]);

  // Broadcast so far-away sticky elements can react to the topbar's own
  // hidden state without prop-drilling.
  useEffect(() => {
    setTopbarHidden(hidden);
  }, [hidden]);
  useEffect(() => () => setTopbarHidden(false), []);

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
        "sticky top-0 z-30 flex items-center gap-2 border-b border-border/20 bg-background/60 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl transition-transform duration-300 will-change-transform",
        "h-[calc(4rem+env(safe-area-inset-top))]",
        hidden ? "-translate-y-full lg:translate-y-0" : "translate-y-0",
        onMessagesIndex && "hidden lg:flex",
      )}
    >
      {/* Far-left: search + add friends — kept apart from the action cluster so
          the right side never gets crowded. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Mobile search entry (the search box is tablet+ only) */}
        <PressIcon className="sm:hidden">
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
        <SuggestionsLauncher />
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
        {/* Create / upload — opens the premium composer */}
        <PressIcon className="hidden sm:inline-flex">
          <button
            type="button"
            onClick={() => openUpload("post")}
            aria-label="Create a post"
            title="Create"
            className="inline-flex h-11 w-11 items-center justify-center"
          >
            <IconTile tint="brand">
              <IoCloudUploadOutline className="h-[21px] w-[21px]" />
            </IconTile>
          </button>
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
