"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { StreakFlame } from "@/features/streaks/streak-flame";
import { CHAT_STREAK_MIN_DAYS, grownStreak } from "@/lib/social/chat-streak";
import type { ConversationSummary } from "@/lib/social/messages";
import { tierFor } from "@/lib/streaks/tiers";

/**
 * CHAT STREAKS ON THE CHAT PAGE (owner, 2026-10-09: "hide the streak icon and fire
 * from the landing and Download page and take it to the chat page … by the side of
 * any user that they both have a conversation for more than up to 2 days and the
 * celebration should be intact … no card, the icon bold and large and the fire
 * animation around it").
 *
 * The days come from the inbox read (conversation_streaks, migration 0200: days on
 * which BOTH of you sent a message). Nothing here asks the network.
 */

export function ChatStreakBadge({ days, className = "" }: { days: number; className?: string }) {
  if (!(days >= CHAT_STREAK_MIN_DAYS)) return null;
  const tier = tierFor(days);
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 text-[13px] font-extrabold tabular-nums text-orange-600 dark:text-orange-400 ${className}`} aria-label={`${days}-day chat streak`} title={`${days}-day streak`}>
      <StreakFlame gradient tier={tier} className="h-[18px] w-[18px]" />
      {days}
    </span>
  );
}

// the burst's code loads only when a streak has actually grown
const StreakFireBurst = dynamic(() => import("@/features/streaks/streak-fire-burst").then((m) => m.StreakFireBurst), { ssr: false });

const SEEN_KEY = "frenz:chat-streaks:seen:v1";

function readSeen(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : null;
  } catch {
    return null;
  }
}


/**
 * Plays the card-less burst once when a chat streak goes up. The first visit only
 * records the counts (an existing streak must not celebrate the day this ships).
 * After that, a grown streak celebrates once and is recorded.
 */
export function ChatStreakCelebrations({ conversations }: { conversations: Pick<ConversationSummary, "id" | "streakDays">[] }) {
  const [burst, setBurst] = useState<{ days: number } | null>(null);

  useEffect(() => {
    const seen = readSeen();
    const next: Record<string, number> = {};
    for (const c of conversations) if ((c.streakDays ?? 0) > 0) next[c.id] = c.streakDays;
    const grown = seen ? grownStreak(conversations, seen) : null;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      /* no storage — nothing celebrates twice within this page anyway */
    }
    if (grown) setBurst({ days: grown.days });
  }, [conversations]);

  if (!burst) return null;
  const tier = tierFor(burst.days);
  if (!tier) return null;
  return <StreakFireBurst tier={tier} label={`Chat streak: ${burst.days} days`} onDone={() => setBurst(null)} />;
}
