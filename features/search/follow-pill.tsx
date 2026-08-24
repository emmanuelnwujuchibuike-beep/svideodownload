"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { toggleFollow, useFollowState } from "@/lib/social/follow-store";
import { cn } from "@/lib/utils";

/**
 * The compact Follow control used on this page's creator cards and people rows.
 *
 * ── Why not `features/social/follow-button.tsx` ───────────────────────────
 * It shares this one's *state* — the same app-wide `follow-store`, the same
 * `/api/follow/[id]` call, the same offline queue — so following someone here
 * still updates their card everywhere else instantly. What it does NOT share
 * is the shell: that button is a `btn-lux` pill sized for a profile action bar,
 * and it calls `router.refresh()` on success. On /search a refresh would
 * re-run the whole server render — re-fetching suggestions, trending tags and
 * the popular-videos rail — to repaint one word of text. That is precisely the
 * "unnecessary API request" this page is not allowed to make.
 *
 * ── Optimistic, with no spinner ───────────────────────────────────────────
 * `toggleFollow` writes to the shared store BEFORE it awaits the network, so
 * the label flips on the same frame as the tap and every other card for that
 * creator flips with it. A spinner would only ever be visible on a slow
 * connection, and it would be showing progress for something already done —
 * so there isn't one. A genuine failure rolls the store back and the label
 * returns; an offline tap is queued for replay rather than rolled back.
 */
export function FollowPill({
  targetId,
  initialFollowing,
  canFollow,
  displayName,
  className,
}: {
  targetId: string;
  initialFollowing: boolean;
  /** False for a signed-out viewer — we never show a follow action without auth. */
  canFollow: boolean;
  /** Used for the accessible name only ("Follow Luna"), never rendered. */
  displayName: string;
  className?: string;
}) {
  const following = useFollowState(targetId, initialFollowing);
  const [busy, setBusy] = useState(false);

  const base =
    "srch-press inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold";

  if (!canFollow) {
    return (
      <Link href="/login?next=/search" className={cn(base, "bg-secondary text-foreground", className)}>
        Follow
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={following}
      aria-label={`${following ? "Unfollow" : "Follow"} ${displayName}`}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        await toggleFollow(targetId, !following);
        setBusy(false);
      }}
      className={cn(
        base,
        following
          ? "bg-secondary text-foreground"
          : "srch-ring text-white shadow-[0_6px_16px_-8px_hsl(var(--brand-purple)/0.9)]",
        className,
      )}
    >
      {following ? (
        <>
          <Check className="h-3.5 w-3.5" aria-hidden /> Following
        </>
      ) : (
        "Follow"
      )}
    </button>
  );
}
