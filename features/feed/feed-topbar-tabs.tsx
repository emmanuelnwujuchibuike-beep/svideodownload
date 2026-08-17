"use client";

import { motion } from "framer-motion";

import { PressIcon } from "@/components/motion/press-icon";
import {
  FrenzFriendsOutline,
  FrenzFriendsSolid,
  FrenzSparkleOutline,
  FrenzSparkleSolid,
} from "@/components/icons/frenz-icons";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { springs } from "@/lib/motion/springs";
import type { HomeFeedSort } from "@/lib/social/home-feed";
import { cn } from "@/lib/utils";

const TABS: {
  key: HomeFeedSort;
  label: string;
  outline: typeof FrenzSparkleOutline;
  solid: typeof FrenzSparkleSolid;
}[] = [
  { key: "for_you", label: "For You", outline: FrenzSparkleOutline, solid: FrenzSparkleSolid },
  { key: "following", label: "Following", outline: FrenzFriendsOutline, solid: FrenzFriendsSolid },
];

// Same two-tier recipe as mobile-nav.tsx's `GLYPH_ACTIVE`/`GLYPH_INACTIVE` —
// reused verbatim (not just "inspired by") so this row's icons read as the
// SAME weight/depth as the bottom nav's, per the owner's own comparison.
const GLYPH_ACTIVE = "text-primary [filter:drop-shadow(0_4px_10px_rgba(79,70,229,0.7))]";
const GLYPH_INACTIVE = "text-muted-foreground [filter:drop-shadow(0_3px_5px_rgba(2,6,23,0.3))]";

/**
 * The feed's segmented control, lifted into the top nav (owner spec: "take
 * For You and Following upwards to the top nav"). The active tab expands to
 * show its label; the inactive one collapses to an icon-only circular chip.
 *
 * 🔴 BLUE GRADIENT PILL REMOVED (owner, 2026-08-17: "remove the blue
 * background on the for you and following button that shows a button is
 * active… use just text icon color active and not a background color just a
 * light premium glass gray background… make the for you and following icon
 * more premium and 3d with a darker and bolder icon like the bottom nav
 * icon"). The vivid `bg-brand` pill this used to animate between tabs is
 * gone — the SAME sliding-pill motion (`layoutId`, unchanged) now animates a
 * neutral glass-gray chip instead, and "active" is signaled by the icon/label
 * turning `text-primary` (color, not a background) plus the mobile-nav-style
 * drop-shadow filter for the bolder/3d look, not by a filled background.
 * Owner correction (2026-07-13, still true): no purple accent dot on the
 * inactive chip.
 *
 * 🔴 REELS REMOVED (owner, 2026-08-16: "move the reel button at the top to
 * bottom in full bleed"). It used to be a third, permanently-inactive tab
 * here that opened the deck instead of toggling `sort`; that affordance now
 * lives as its own tab in the bottom nav (see mobile-nav.tsx) instead of
 * sharing this segmented control. Swiping past "Following" still opens Reels
 * in place (smart-feed.tsx's `swipeTo`/`onSegment("recent")`) — that gesture
 * is unrelated to this row and stays exactly as it was.
 */
export function FeedTopbarTabs({
  sort,
  onSegment,
}: {
  sort: HomeFeedSort;
  onSegment: (key: HomeFeedSort) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {TABS.map((t) => {
        const active = sort === t.key;
        const Icon = active ? t.solid : t.outline;
        return (
          <motion.button
            key={t.key}
            type="button"
            onClick={() => {
              // Same shared tick as the bottom nav (owner ask) — the top nav's
              // tabs are a navigation-equivalent action, so they should feel
              // like one.
              haptic("light");
              playSound("tap");
              onSegment(t.key);
            }}
            aria-label={t.label}
            aria-pressed={active}
            whileTap={{ scale: 0.92 }}
            transition={springs.press}
            className={cn(
              "relative flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full font-bold transition-colors",
              active ? cn("px-4 text-[13px] text-primary") : cn("w-10 text-muted-foreground", "hover:bg-secondary"),
            )}
          >
            {active ? (
              <motion.span
                layoutId="feed-topbar-pill"
                transition={springs.bounce}
                className="absolute inset-0 -z-10 rounded-full bg-secondary/70 ring-1 ring-inset ring-border/60"
              />
            ) : (
              <span className="absolute inset-0 -z-10 rounded-full bg-secondary/50 ring-1 ring-inset ring-border/50" />
            )}
            <PressIcon active={active}>
              <Icon className={cn(active ? "h-[18px] w-[18px]" : "h-5 w-5", active ? GLYPH_ACTIVE : GLYPH_INACTIVE)} />
            </PressIcon>
            {active ? <span className="whitespace-nowrap">{t.label}</span> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
