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
  // renders its solid glyph, matching its permanently-accented violet look.
  { key: "recent", label: "Reels", outline: FrenzReelsSolid, solid: FrenzReelsSolid },
];

/**
 * The feed's segmented control, lifted into the top nav (owner spec: "take
 * For You, Following and Reels upwards to the top nav"). High-contrast,
 * icon-forward: the active tab expands into a solid brand-gradient pill
 * (white icon+label — the strongest contrast in the bar), the others collapse
 * to a plain icon so three labels never fight for the topbar's tight width.
 * "Reels" never carries the active state itself (tapping it opens the deck /
 * navigates away rather than selecting a persistent tab — `sort` never
 * becomes "recent") — it stays a colored launcher pill instead of faking a
 * toggle state it doesn't have.
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
    <div className="flex items-center gap-1.5">
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
              "relative flex shrink-0 items-center gap-1.5 rounded-full py-2 font-bold transition-colors",
              active ? "px-3.5 text-[13px] text-white" : "h-9 w-9 justify-center",
              !active && isReels && "text-white",
              // The topbar reverted to the standard theme-following background
              // (app-topbar.tsx no longer has a Home-only dark gradient wash),
              // so inactive tabs go back to the app's normal muted/foreground
              // pair instead of a fixed light tone.
              !active && !isReels && "text-foreground/60 hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="feed-topbar-pill"
                transition={springs.bounce}
                className="absolute inset-0 -z-10 rounded-full bg-brand-tile shadow-[0_4px_16px_-4px] shadow-[hsl(var(--brand-purple)/0.45)]"
              />
            ) : null}
            {/* Reels always keeps its own tinted backdrop (it never gets the
                active pill treatment, so it needs its own way to read as
                clearly tappable/important, not just another filter icon).
                Owner (2026-07-11): make it obviously "the Reels button" now
                that Trending Reels no longer gives mobile a second, bigger
                entry point — a full brand tile (not just a faint tint) so
                it's unmistakable at a glance. */}
            {!active && isReels ? (
              <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-brand-tile shadow-[0_3px_10px_-2px] shadow-[hsl(var(--brand-purple)/0.4)]" />
            ) : null}
            <PressIcon active={active}>
              <Icon className={cn(active || !isReels ? "h-[18px] w-[18px]" : "h-[22px] w-[22px] drop-shadow-sm")} />
            </PressIcon>
            {active ? <span className="whitespace-nowrap">{t.label}</span> : null}
          </motion.button>
        );
      })}
    </div>
  );
}
