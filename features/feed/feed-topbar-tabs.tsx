"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { LockIcon } from "@/features/frenz-ui/icons";
import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import type { HomeFeedSort } from "@/lib/social/home-feed";
import { cn } from "@/lib/utils";

/*
  The Feed's tab row (design/Feed.dc.html, 2026-10-18): For You · Following ·
  Reels · Exclusive, Sora 16 px, the active one in ink with the brand-gradient
  underline (an active-state indicator — allowed), the rest muted. Its own row
  under the top bar, above the stories — no longer squeezed into the top bar's
  centre. CSS only: no animation library on a row every Feed visit paints.

  Exclusive sits here as the fourth tab (owner, 2026-10-18: "the new feed has
  exclusive at the top"), with its lock. It opens the Exclusive feed.
*/

const TABS: { key: HomeFeedSort; label: string }[] = [
  { key: "for_you", label: "For You" },
  { key: "following", label: "Following" },
];

// design/frenz-exclusive-feed.html (owner, 2026-10-31): 17.5 px bold, ink-2 until active (#4A4A55 — the design's #8A8A96 vanished over dark media under the glass, owner 2026-10-31), spread across the row
const TAB =
  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 pb-[15px] pt-[8px] text-[17.5px] font-bold tracking-[-0.01em] whitespace-nowrap no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2";

function Underline() {
  return <span aria-hidden className="absolute inset-x-0 -bottom-px h-1 rounded-t bg-[linear-gradient(90deg,#5B5BF0,#7B5CF0)]" />;
}

function tap() {
  haptic("light");
  playSound("tap");
}

export function FeedTopbarTabs({
  sort,
  onSegment,
  showReelsLink,
}: {
  sort: HomeFeedSort;
  onSegment: (key: HomeFeedSort) => void;
  showReelsLink?: boolean;
}) {
  const row = <FeedTabRow active={sort} onSegment={onSegment} showReelsLink={showReelsLink} />;
  return <ScrollUpTabs>{row}</ScrollUpTabs>;
}

/*
  🔴 THE TABS COME BACK ON THE WAY UP (owner, 2026-10-28: "let this tab in feed stick when scrolling upward — it should
  show when scrolling upward, then hide and show just the floating buttons when scrolling downwards").
  The row stays where the design puts it (above the stories). Once it has scrolled out of view, a copy rides under the
  floating glass buttons: it slides in the moment the reader scrolls UP and tucks away the moment they scroll DOWN, so
  scrolling down shows only the floating buttons. Phones only (the desktop bar is a normal sticky header). It reads the
  app's one scroll-direction store (no new scroll listener) and one IntersectionObserver on the row; transform and
  opacity only. Portalled to <body> — a `fixed` bar inside a transformed ancestor would be positioned against it.
*/
function ScrollUpTabs({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dir = useScrollDirection();
  useEffect(() => {
    setMounted(true);
    const el = anchor.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(!!e && !e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const shown = away && dir === "up";
  return (
    <>
      <div ref={anchor}>{children}</div>
      {mounted
        ? createPortal(
            <div
              aria-hidden={!shown}
              inert={!shown}
              className={cn(
                // from the very top, under the floating buttons (the header is z-30): the strip behind the buttons is the
                // bar too, so a post never shows through between the clock, the buttons and the tabs (owner, 2026-10-29)
                "fixed inset-x-0 top-0 z-[29] border-b border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.52))] pt-[calc(var(--frenz-safe-top)+3.5rem)] shadow-[0_1px_0_rgba(14,14,18,.04),0_10px_30px_-20px_rgba(40,30,90,.25)] backdrop-blur-[26px] backdrop-saturate-[1.9] dark:border-white/10 dark:bg-frenz-page/80 [&>nav]:!mx-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none lg:hidden",
                shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
              )}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/*
  🔴 ONE ROW, BOTH PAGES, NAVIGATING LIKE THE BOTTOM NAV (owner, 2026-10-31: "navigation with the top nav in feed page
  reload on going back, from exclusive page to for you and following and the top nav structure changes when I enter
  the exclusive feed page … the top nav in feed page is supposed to navigate like the bottom NAV").

  · The Exclusive page drew its OWN copy of this row — left-packed (gap-[22px]) where the Feed's is spread
    (justify-between), a bigger lock — so every switch moved the tabs. Both pages now render this one row.
  · Its For You / Following went to /home?tab=…: a different ADDRESS from the bottom nav's /home, and the router keeps
    pages per address, so every tap was a fresh server load (the loading strip). They now go to plain /home — the same
    cached page the bottom nav's Feed tab opens — and hand the wanted tab over in memory (requestFeedTab; smart-feed
    takes it on mount). /home?tab=… still works for an old link.
  · Like the bottom nav: no viewport prefetch, the page is warmed the moment a finger touches the tab.
*/
let requestedFeedTab: HomeFeedSort | null = null;

/** The Feed tab the next /home mount should open on (set by this row on the Exclusive page). */
export function requestFeedTab(key: HomeFeedSort) {
  requestedFeedTab = key;
}

/** Read once by smart-feed on mount; cleared so a later visit isn't re-steered. */
export function takeRequestedFeedTab(): HomeFeedSort | null {
  const k = requestedFeedTab;
  requestedFeedTab = null;
  return k;
}

const IDLE = "text-[#4A4A55] hover:text-frenz-ink dark:text-white/60";

function FeedTabRow({
  active,
  onSegment,
  showReelsLink,
}: {
  /** the Feed's current segment, or "exclusive" on the Exclusive page */
  active: HomeFeedSort | "exclusive";
  /** on the Feed: switch in place. Absent (the Exclusive page): go to /home on that tab. */
  onSegment?: (key: HomeFeedSort) => void;
  showReelsLink?: boolean;
}) {
  const router = useRouter();
  const onFeed = !!onSegment;
  return (
    <nav aria-label="Feed type" className="frenz-ui flex justify-between gap-4 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain px-[18px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => {
        const isActive = active === t.key;
        const cls = cn(TAB, isActive ? "text-frenz-ink" : IDLE);
        const body = (
          <>
            {t.label}
            {isActive ? <Underline /> : null}
          </>
        );
        return onFeed ? (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              tap();
              onSegment!(t.key);
            }}
            aria-current={isActive ? "page" : undefined}
            className={cls}
          >
            {body}
          </button>
        ) : (
          <Link
            key={t.key}
            href="/home"
            prefetch={false}
            onPointerDown={() => router.prefetch("/home")}
            onClick={() => {
              tap();
              requestFeedTab(t.key);
            }}
            className={cls}
          >
            {body}
          </Link>
        );
      })}
      {onFeed && !showReelsLink ? (
        <button
          type="button"
          onClick={() => {
            tap();
            onSegment!("recent");
          }}
          className={cn(TAB, IDLE)}
        >
          Reels
        </button>
      ) : (
        // Reels keeps its viewport prefetch (as the Feed always had it) — Reels must not open slower
        <Link href="/reels" onClick={tap} className={cn(TAB, IDLE)}>
          Reels
        </Link>
      )}
      {active === "exclusive" ? (
        <span aria-current="page" className={cn(TAB, "text-frenz-ink")}>
          <LockIcon size={15} strokeWidth={2.4} className="text-[#7B5CF0]" />
          Exclusive
          <Underline />
        </span>
      ) : (
        <Link href="/exclusive" prefetch={false} onPointerDown={() => router.prefetch("/exclusive")} onClick={tap} className={cn(TAB, IDLE)}>
          <LockIcon size={15} strokeWidth={2.4} />
          Exclusive
        </Link>
      )}
    </nav>
  );
}

/**
 * The same tab row on the Exclusive page (design/ExclusiveFeed.dc.html, owner 2026-10-18: Exclusive is the Feed's
 * fourth tab) — the SAME component and placement as the Feed's (FEED_TABS_SLOT's wrapper: -mx-3 mb-1 sm:-mx-4), so
 * nothing moves when switching; Exclusive is the active one.
 */
export function FeedTabLinks() {
  return (
    <div className="-mx-3 mb-1 sm:-mx-4">
      <ScrollUpTabs>
        <FeedTabRow active="exclusive" />
      </ScrollUpTabs>
    </div>
  );
}
