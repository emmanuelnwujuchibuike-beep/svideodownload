"use client";

import { useEffect, useState } from "react";

import { usePresence } from "@/features/friends/use-presence";

function lastSeenLabel(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "last seen just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `last seen ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `last seen ${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `last seen ${d}d ago`;
  return `last seen ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * Live "online" state for a chat header: green pulsing dot + label while the
 * user is in the shared presence channel; otherwise "last seen Xm ago" when
 * known (never shown for an invisible user — the API route already omits
 * it), falling back to plain @handle.
 */
export function PresenceBadge({ userId, handle }: { userId: string; handle: string }) {
  const online = usePresence().has(userId);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (online) return;
    let cancelled = false;
    void fetch(`/api/presence-status?ids=${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.lastSeen?.[userId]) setLastSeen(d.lastSeen[userId]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, online]);

  if (online) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />
          <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        online
      </span>
    );
  }
  return (
    <span className="block truncate text-xs text-muted-foreground">
      {lastSeen ? lastSeenLabel(lastSeen) : `@${handle}`}
    </span>
  );
}
