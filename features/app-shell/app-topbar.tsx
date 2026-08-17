"use client";

import { IoAdd, IoCloudUploadOutline, IoSearchOutline } from "react-icons/io5";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { PressIcon } from "@/components/motion/press-icon";
import { IconTile } from "@/components/icons/icon-tile";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppMode } from "@/features/app-shell/use-app-mode";
import { NotificationBell } from "@/features/app-shell/notification-bell";
import { setTopbarHidden } from "@/features/app-shell/topbar-visibility";
import { useTopbarCenter } from "@/features/app-shell/topbar-slot";
import { UserMenu } from "@/features/auth/user-menu";
import { CreateActionSheet } from "@/features/create/create-action-sheet";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

export function AppTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const mode = useAppMode();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // The owner's Messages mockup starts straight at the big "Messages" title —
  // no global topbar above it on mobile. That page carries its own header
  // (compose + tools circles), so the topbar hides there below lg; every
  // other route keeps it. Thread pages already cover it with their own
  // full-screen overlay, so only the index needs this.
  const onMessagesIndex = pathname === "/messages";
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The feed lifts its For You/Following control up here (owner spec) —
  // every other page's search bar is untouched, since only the feed ever
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
        // 🔴 PURPLE WASH REMOVED ENTIRELY (owner, 2026-08-16: "remove the top
        // purple gradient on the download page entirely" — after several
        // rounds of retuning it, not a request for another adjustment). Plain
        // `bg-background`, matching every other page's header. Do not re-add
        // a gradient here without a fresh, explicit ask — this exact feature
        // was built, reshaped twice for seam/intensity issues, and then
        // explicitly removed in one conversation.
        "border-b border-border/20 bg-background",
        onMessagesIndex && "hidden lg:flex",
      )}
    >
      {/* Far-left: search + create — kept apart from the action cluster so
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
            className="flex h-11 w-11 items-center justify-center"
          >
            <IconTile>
              <IoSearchOutline className="h-[26px] w-[26px]" />
            </IconTile>
          </Link>
        </PressIcon>
        {/*
          🔴 CREATE, MOVED HERE FROM THE BOTTOM NAV (owner, 2026-08-16: "move
          the + button to top just like [Facebook/Instagram] style, don't
          make the plus button round, make it professional"), then swapped
          into the ADD-FRIENDS slot (owner, same day: "remove the add friend
          button from the top header in feed and move the plus button to
          where the add friend button was"). `SuggestionsLauncher` is gone
          from this bar entirely — this is the last icon in the cluster now,
          exactly where it stood.

          `lg:hidden` matches exactly where the bottom nav (and the "+" that
          used to live in it) is shown — the desktop sidebar has no Create
          entry of its own, so the pre-existing desktop icon further down
          this bar stays as the wide-screen entry point. Mode-gated the same
          way the old bottom-nav button was: Downloader mode has no
          Create/Chats, those are Full Bleed features only.
        */}
        {mode !== "downloader" ? (
          <PressIcon className="lg:hidden">
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                playSound("tap");
                setCreateOpen(true);
              }}
              aria-label="Create"
              aria-haspopup="dialog"
              aria-expanded={createOpen}
              /*
                🔴 CORRECTED — NO BACKGROUND AT ALL (owner, 2026-08-17, after
                the gradient-tile attempt directly below: "i didnt say give it
                a blue background, i meant a black plus icon alone that is 3d
                with dark contrast and bolder like the bottom nav icon... i
                said remove the border so only the icon stays darker, more 3d
                and bolder"). The gradient tile was solving a problem the
                owner never described — a filled box, when a bare, bolder
                GLYPH was what was asked for both times. `mobile-nav.tsx`'s
                own bottom-nav icons are exactly this recipe: no background,
                `text-foreground` (the darkest token, not a brand tint), a
                `drop-shadow` filter for the "3d" lift, and — the actual
                boldness lever for an Ionicon, which has no useful
                `strokeWidth` — the FILLED glyph (`IoAdd`) instead of the
                outline one every other icon in this bar uses, so it reads as
                visually heavier without a box around it.
              */
              className="flex h-11 w-11 items-center justify-center text-foreground transition active:scale-95"
            >
              <IoAdd className="h-7 w-7 [filter:drop-shadow(0_3px_5px_rgba(2,6,23,0.35))]" />
            </button>
          </PressIcon>
        ) : null}
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
            className="flex h-11 w-11 items-center justify-center"
          >
              <IconTile>
                <IoSearchOutline className="h-[26px] w-[26px]" />
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
            no shared composer to re-steer any more). Desktop only: below
            `lg` the plain "+" in the far-left cluster is the one Create
            entry (opening the fuller action sheet) — `hidden lg:inline-flex`
            keeps the two from ever showing at the same time on a tablet.
            Mode-gated the same as its mobile counterpart: Downloader mode
            has no Create surface at all. */}
        {mode !== "downloader" ? (
          <PressIcon className="hidden lg:inline-flex">
            <Link
              href="/create/post"
              onPointerDown={() => router.prefetch("/create/post")}
              aria-label="Create a post"
              title="Create"
              className="inline-flex h-11 w-11 items-center justify-center"
            >
              <IconTile>
                <IoCloudUploadOutline className="h-[26px] w-[26px]" />
              </IconTile>
            </Link>
          </PressIcon>
        ) : null}

        {/* Notifications — mobile/tablet only (large screens use the sidebar
            Notifications item, so the top-right stays uncluttered). The
            mockup's other right-side circle (two-people) is the feed's own
            Following segment, rendered by FeedTopbarTabs in the center slot
            — adding a separate Friends icon here duplicated it and pushed
            this bell off-screen. */}
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
      {/* The "+" action sheet (owner's picked mockup) — triggered by the plain
          "+" above. Rendered here rather than in AppOverlays because nothing
          else can open it, so its state has no reason to be global. It
          portals to <body>, so this header's own stacking can't trap it. */}
      <CreateActionSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </header>
  );
}
