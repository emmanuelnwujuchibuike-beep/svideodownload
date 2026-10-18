"use client";

import Link from "next/link";

import { LockIcon } from "@/features/frenz-ui/icons";
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
  return <span aria-hidden className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-frenz-gradient-x" />;
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
  return (
    <nav aria-label="Feed type" className="frenz-ui flex gap-[22px] overflow-x-auto border-b border-frenz-line px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
