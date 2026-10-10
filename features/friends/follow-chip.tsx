"use client";

import { UserCheck, UserPlus } from "lucide-react";

import type { FollowSource } from "@/lib/social/follow-policy";
import { toggleFollow, useFollowState } from "@/lib/social/follow-store";
import { cn } from "@/lib/utils";

/**
 * Follow / Following.
 *
 * Same shared store as everywhere else, so the state is optimistic and app-wide.
 * The accessible name carries the person and the state ("Follow Chris" becomes
 * "Following Chris"), because a screen reader cannot see a colour change.
 */
export function FollowChip({ id, name, initial, source = "suggestion" }: { id: string; name: string; initial: boolean; source?: FollowSource }) {
  const following = useFollowState(id, initial);
  return (
    <button
      type="button"
      onClick={() => void toggleFollow(id, !following, source)}
      aria-pressed={following}
      aria-label={following ? `Following ${name}. Tap to unfollow.` : `Follow ${name}`}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold max-[359px]:px-2.5",
        "transition-transform duration-150 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
        following
          ? "bg-black/[0.05] text-foreground/80 dark:bg-white/[0.08]"
          : "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.7)]",
      )}
    >
      {following ? (
        <>
          <UserCheck className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Following</span>
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4" aria-hidden /> <span className="max-[359px]:sr-only">Follow</span>
        </>
      )}
    </button>
  );
}

