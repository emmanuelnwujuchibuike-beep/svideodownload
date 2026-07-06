"use client";

import { IoCloudDownloadOutline, IoCloudUploadOutline, IoSearchOutline } from "react-icons/io5";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/app-shell/notification-bell";
import { setTopbarHidden } from "@/features/app-shell/topbar-visibility";
import { openUpload } from "@/features/create/upload-store";
import { UserMenu } from "@/features/auth/user-menu";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { cn } from "@/lib/utils";

export function AppTopbar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
  // anywhere meaningful to scroll.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 72) setHidden(false);
        else if (delta > 4) setHidden(true);
        else if (delta < -4) setHidden(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Broadcast so far-away sticky elements (the feed's segmented control) can
  // shift up and fill the gap instead of leaving blank space above them.
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
      )}
    >
      {/* Far-left: search + add friends — kept apart from the action cluster so
          the right side never gets crowded. */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Mobile search entry (the search box is tablet+ only) */}
        <Link
          href="/search"
          aria-label="Search"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary active:scale-95 sm:hidden"
        >
          <IoSearchOutline className="h-[20px] w-[20px]" />
        </Link>
        {/* Add friends — single top-nav icon */}
        <SuggestionsLauncher />
      </div>

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

      {/* Right action cluster */}
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/downloads"
          className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/25 ring-1 ring-inset ring-white/10 transition hover:shadow-xl hover:shadow-violet-500/40"
        >
          <IoCloudDownloadOutline className="h-[18px] w-[18px] transition-transform group-hover:translate-y-0.5" />
          <span className="hidden sm:inline">Download</span>
        </Link>

        {/* Create / upload — opens the premium composer */}
        <button
          type="button"
          onClick={() => openUpload("post")}
          aria-label="Create a post"
          title="Create"
          className="hidden h-11 w-11 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary hover:text-primary hover:ring-primary/40 sm:inline-flex"
        >
          <IoCloudUploadOutline className="h-[21px] w-[21px]" />
        </button>

        {/* Notifications — mobile/tablet only (large screens use the sidebar
            Notifications item, so the top-right stays uncluttered). */}
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
