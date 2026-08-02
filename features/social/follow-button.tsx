"use client";

import { Loader2, UserCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toggleFollow as toggleFollowShared, useFollowState } from "@/lib/social/follow-store";
import { cn } from "@/lib/utils";

/**
 * Follow / Following toggle. Optimistic, reverts on error. Anonymous viewers are
 * routed to sign-in (we never expose a follow action without auth).
 *
 * Relationship-aware (Adaptive Relationship Engine · Part 7): when this person
 * already follows the viewer and the viewer doesn't follow back yet, the label
 * becomes "Follow back" — the button understands the relationship instead of
 * showing the same static text for everyone.
 */
export function FollowButton({
  targetId,
  initialFollowing,
  canFollow,
  followsYou = false,
  className,
}: {
  targetId: string;
  initialFollowing: boolean;
  canFollow: boolean;
  /** This profile already follows the viewer — surfaces a "Follow back" label. */
  followsYou?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const following = useFollowState(targetId, initialFollowing);
  const [busy, setBusy] = useState(false);

  if (!canFollow) {
    return (
      <Link href="/login?next=/account" className={cn("btn-lux btn-lux-primary", className)}>
        <UserPlus className="h-4 w-4" /> Follow
      </Link>
    );
  }

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const settled = await toggleFollowShared(targetId, !following);
    if (settled === !following) router.refresh(); // succeeded
    setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={cn("btn-lux", following ? "btn-lux-secondary" : "btn-lux-primary", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : following ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      {following ? "Following" : followsYou ? "Follow back" : "Follow"}
    </button>
  );
}
