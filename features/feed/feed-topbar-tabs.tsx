"use client";

import { motion } from "framer-motion";

import { PressIcon } from "@/components/motion/press-icon";
import {
  FrenzFriendsOutline,
  FrenzFriendsSolid,
  FrenzReelsSolid,
  FrenzSparkleOutline,
  FrenzSparkleSolid,
} from "@/components/icons/frenz-icons";
import { NavDot } from "@/components/icons/nav-dot";
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
  // Reels never carries the active/toggle state (see below) — it always
  // renders its solid glyph.
  { key: "recent", label: "Reels", outline: FrenzReelsSolid, solid: FrenzReelsSolid },
];

/**
 * The feed's segmented control, lifted into the top nav (owner spec: "take
 * For You, Following and Reels upwards to the top nav"). Matches the owner's
 * mockup: the active tab ("For You" by default) expands into a vivid
 * blue→purple brand-gradient pill (white icon+label), the others collapse to
 * a plain circular chip — the same flat gray look as the search/add-friend
 * icons either side of this row — each carrying a small brand-purple accent
 * dot, so all six top-nav icons read as one consistent row. "Reels" never
 * carries the active state itself (tapping it opens the deck / navigates
 * away rather than selecting a persistent tab — `sort` never becomes
 * "recent"), so it always renders as that same plain chip+dot.
 */
export function FeedTopbarTabs({
  sort,
  onSegment,
  onReelsPreload,
}: {
  sort: HomeFeedSort;
  onSegment: (key: HomeFeedSort) => void;
  /** Belt-and-suspenders reels-chunk warm-up on pointerdown (fires before click). */
  onReelsPreload?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {TABS.map((t) => {
        const active = sort === t.key;
        const isReels = t.key === "recent";
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
            onPointerDown={isReels ? onReelsPreload : undefined}
            aria-label={t.label}
            aria-pressed={active}
            whileTap={{ scale: 0.92 }}
            transition={springs.press}
            className={cn(
              "relative flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full font-bold transition-colors",
              active
                ? "px-4 text-[13px] text-white"
                : "w-10 bg-secondary/50 text-foreground/85 ring-1 ring-inset ring-border/50 hover:bg-secondary",
            )}
          >
            {active ? (
              <motion.span
                layoutId="feed-topbar-pill"
                transition={springs.bounce}
                className="absolute inset-0 -z-10 rounded-full bg-brand shadow-[0_4px_16px_-4px] shadow-[hsl(var(--brand-purple)/0.45)]"
              />
            ) : null}
            <PressIcon active={active}>
              <Icon className={active ? "h-[18px] w-[18px]" : "h-5 w-5"} />
            </PressIcon>
            {active ? <span className="whitespace-nowrap">{t.label}</span> : null}
            {!active ? <NavDot /> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
