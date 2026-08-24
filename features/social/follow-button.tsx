"use client";

import { Loader2, UserCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { promptCreatorNotifications } from "@/features/social/creator-notify-nudge";
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
  targetHandle,
}: {
  targetId: string;
  initialFollowing: boolean;
  canFollow: boolean;
  /** This profile already follows the viewer — surfaces a "Follow back" label. */
  followsYou?: boolean;
  className?: string;
  /**
   * The @handle, used only for the notification prompt that drops down after a
   * successful follow (owner, 2026-08-24). Optional so the many call sites that
   * do not have it handy keep working unchanged — without it the follow still
   * succeeds and simply raises no prompt, which is better than blocking the
   * feature on threading a handle through every list component.
   */
  targetHandle?: string;
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
    const wantFollow = !following;
    const settled = await toggleFollowShared(targetId, wantFollow);
    if (settled === wantFollow) {
      router.refresh(); // succeeded
      /*
        Offer that creator's notifications, once, right after a FOLLOW (owner,
        2026-08-24: "when added or following a pop down promt from top should
        show a message saying turn on username notification, story, post...").

        Only on the follow direction — prompting someone who just UNFOLLOWED to
        turn on notifications would be the opposite of reading the room. Also
        only when a handle was supplied, since the prompt names the person.
      */
      if (wantFollow && targetHandle) {
        promptCreatorNotifications({ userId: targetId, handle: targetHandle, reason: "followed" });
      }
    }
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
