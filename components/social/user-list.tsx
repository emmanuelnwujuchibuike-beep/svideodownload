import { BadgeCheck } from "lucide-react";
import Link from "next/link";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { FollowButton } from "@/features/social/follow-button";
import { UnblockButton } from "@/features/social/unblock-button";
import type { ListUser } from "@/lib/social/profile";

/**
 * Reusable list of user cards (followers / following / blocked). The trailing
 * action depends on `mode`. Server component — renders the interactive buttons
 * (which are client components) per row.
 */
export function UserList({
  users,
  viewerId,
  mode = "follow",
  emptyText = "Nobody here yet.",
}: {
  users: ListUser[];
  viewerId: string | null;
  mode?: "follow" | "blocked";
  emptyText?: string;
}) {
  if (users.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-border/60">
      {users.map((u) => (
        <li key={u.id} className="flex items-center gap-3 py-3">
          <Link href={`/u/${u.handle}`} className="shrink-0">
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
                {u.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </Link>
          <Link href={`/u/${u.handle}`} className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{u.displayName}</span>
              {u.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
              <DiamondCrownBadge plan={u.plan} size="xs" />
            </span>
            <span className="block truncate text-xs text-muted-foreground">@{u.handle}</span>
            {u.bio ? <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{u.bio}</span> : null}
          </Link>
          {mode === "blocked" ? (
            <UnblockButton targetId={u.id} />
          ) : viewerId && viewerId !== u.id ? (
            <FollowButton targetId={u.id} initialFollowing={u.viewerFollows} canFollow />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
