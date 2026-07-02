"use client";

import { usePresence } from "@/features/friends/use-presence";

/**
 * Live "online" state for a chat header: green pulsing dot + label while the
 * user is in the shared presence channel, otherwise falls back to @handle.
 */
export function PresenceBadge({ userId, handle }: { userId: string; handle: string }) {
  const online = usePresence().has(userId);
  return online ? (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
      <span className="relative flex h-2 w-2">
        <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
        <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      online
    </span>
  ) : (
    <span className="block truncate text-xs text-muted-foreground">@{handle}</span>
  );
}
