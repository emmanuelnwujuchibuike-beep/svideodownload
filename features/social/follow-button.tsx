"use client";

import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Follow / Following toggle. Optimistic, reverts on error. Anonymous viewers are
 * routed to sign-in (we never expose a follow action without auth).
 */
export function FollowButton({
  targetId,
  initialFollowing,
  canFollow,
  className,
}: {
  targetId: string;
  initialFollowing: boolean;
  canFollow: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  if (!canFollow) {
    return (
      <a
        href="/login?next=/account"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
          className,
        )}
      >
        <UserPlus className="h-4 w-4" /> Follow
      </a>
    );
  }

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic
    try {
      const res = await fetch(`/api/follow/${targetId}`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) setFollowing(!next);
      else router.refresh();
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
        following
          ? "border border-border bg-card text-foreground hover:border-red-500/40 hover:text-red-400"
          : "bg-primary text-primary-foreground hover:opacity-90",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : following ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}
