"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { PendingButton, PendingLink } from "@/features/frenz-ui/pending";

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
 * ── A spinner on the tap, then "Following" (Search & Discover design, 2026-10-26) ──
 * "Every Follow button shows an inline spinner on tap, then switches to Following."
 * `toggleFollow` still writes the shared store before it awaits the network, so
 * every other card for that creator flips at once; THIS button shows the shared
 * spinner (width locked, label kept in the layout) until the server answers, then
 * the new label. A genuine failure rolls the store back and the label returns; an
 * offline tap is queued for replay rather than rolled back.
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
    "inline-flex h-11 min-w-[96px] shrink-0 items-center justify-center gap-1.5 rounded-[22px] px-4 font-heading text-[14px] font-bold";

  if (!canFollow) {
    return (
      <PendingLink href="/login?next=/search" prefetch={false} className={cn(base, "bg-frenz-fill text-frenz-ink", className)} spinnerSize={15}>
        Follow
      </PendingLink>
    );
  }

  return (
    <PendingButton
      pending={busy}
      spinnerSize={15}
      aria-pressed={following}
      aria-label={`${following ? "Unfollow" : "Follow"} ${displayName}`}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        await toggleFollow(targetId, !following, "search");
        setBusy(false);
      }}
      className={cn(
        base,
        following
          ? "border border-frenz-line bg-frenz-card text-frenz-ink"
          : "bg-frenz-gradient-x text-white shadow-[0_10px_22px_-12px_rgb(91_63_240/0.8)]",
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
    </PendingButton>
  );
}
