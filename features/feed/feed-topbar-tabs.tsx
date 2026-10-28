"use client";

import Link from "next/link";
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

const TAB =
  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 pb-3 pt-2.5 font-heading text-base no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2";

function Underline() {
  return <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-frenz-gradient-x" />;
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
  const row = <FeedTabRow sort={sort} onSegment={onSegment} showReelsLink={showReelsLink} />;
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
                "fixed inset-x-0 top-[calc(var(--frenz-safe-top)+4rem)] z-40 bg-frenz-page/90 backdrop-blur-xl [&>nav]:!mx-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none lg:hidden",
                shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-[calc(100%+4rem)] opacity-0",
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

function FeedTabRow({ sort, onSegment, showReelsLink }: { sort: HomeFeedSort; onSegment: (key: HomeFeedSort) => void; showReelsLink?: boolean }) {
  return (
    <nav aria-label="Feed type" className="frenz-ui flex gap-[22px] touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-frenz-line px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => {
        const active = sort === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              tap();
              onSegment(t.key);
            }}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active ? "font-bold text-frenz-ink" : "font-semibold text-frenz-muted hover:text-frenz-ink")}
          >
            {t.label}
            {active ? <Underline /> : null}
          </button>
        );
      })}
      {showReelsLink ? (
        <Link href="/reels" onClick={tap} className={cn(TAB, "font-semibold text-frenz-muted hover:text-frenz-ink")}>
          Reels
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => {
            tap();
            onSegment("recent");
          }}
          className={cn(TAB, "font-semibold text-frenz-muted hover:text-frenz-ink")}
        >
          Reels
        </button>
      )}
      <Link href="/exclusive" prefetch={false} onClick={tap} className={cn(TAB, "font-semibold text-frenz-muted hover:text-frenz-ink")}>
        <LockIcon size={15} strokeWidth={2.4} />
        Exclusive
      </Link>
    </nav>
  );
}

/**
 * The same tab row on the Exclusive page (design/ExclusiveFeed.dc.html, owner 2026-10-18: Exclusive is the
 * Feed's fourth tab): For You and Following go back to the Feed on that tab (`/home?tab=…`, read once by
 * smart-feed), Reels to Reels, and Exclusive is the active one.
 */
export function FeedTabLinks() {
  const link = cn(TAB, "font-semibold text-frenz-muted hover:text-frenz-ink");
  // the same come-back-on-the-way-up row as the Feed (owner, 2026-10-28)
  return (
    <ScrollUpTabs>
    <nav aria-label="Feed type" className="frenz-ui -mx-3 flex gap-[22px] touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-frenz-line px-5 [scrollbar-width:none] sm:-mx-4 [&::-webkit-scrollbar]:hidden">
      <Link href="/home?tab=for_you" prefetch={false} onClick={tap} className={link}>
        For You
      </Link>
      <Link href="/home?tab=following" prefetch={false} onClick={tap} className={link}>
        Following
      </Link>
      <Link href="/reels" prefetch={false} onClick={tap} className={link}>
        Reels
      </Link>
      <span aria-current="page" className={cn(TAB, "font-bold text-frenz-ink")}>
        <LockIcon size={15} strokeWidth={2.4} />
        Exclusive
        <Underline />
      </span>
    </nav>
    </ScrollUpTabs>
  );
}
