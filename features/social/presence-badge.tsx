"use client";

import { useEffect, useState } from "react";

import { usePresence } from "@/features/friends/use-presence";
import { cn } from "@/lib/utils";

/*
  Owner, 2026-10-11: nothing should refetch on every entry. Re-opening the same
  chat within a minute (a back-swipe, a quick switch) reuses the last answer.
*/
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; lastSeen: string | null; details: { line: string | null; autoReply: string | null } | null }>();

function lastSeenLabel(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  // Part 9: "Recently active" - no minute count for the first few minutes, so nobody watches a clock tick
  if (s < 300) return "active recently";
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
export function PresenceBadge({
  userId,
  handle,
  /** Matches the thread header's own forced-light default (owner ask: white,
   *  WhatsApp-style background) — `text-muted-foreground` is light-toned in
   *  dark app mode and read as washed-out against a forced-white header. */
  forceLight = false,
}: {
  userId: string;
  handle: string;
  forceLight?: boolean;
}) {
  const { online, lastSeen, details } = usePresenceDetails(userId);

  const extra = [details?.line, details?.autoReply].filter(Boolean).join(" · ");
  if (online) {
    // "Active now" — the owner's chat mockup's exact label (was "online").
    return (
      <span className="block truncate text-xs" title={extra || undefined}>
        <span className="font-medium text-emerald-500">Active now</span>
        {extra ? <span className={cn("text-muted-foreground", forceLight && "!text-neutral-500")}> · {extra}</span> : null}
      </span>
    );
  }
  const base = lastSeen ? lastSeenLabel(lastSeen) : extra ? null : `@${handle}`;
  return (
    <span className={cn("block truncate text-xs text-muted-foreground", forceLight && "!text-neutral-500")} title={extra || undefined}>
      {[extra, base].filter(Boolean).join(" · ")}
    </span>
  );
}

/**
 * "Active now" / "Last seen 7m ago" alone — the chat options sheet's "@handle · last seen" line
 * (design/ChatMenu.dc.html). Nothing when the person doesn't share it.
 */
export function PresenceLastSeen({ userId }: { userId: string }) {
  const { online, lastSeen } = usePresenceDetails(userId);
  if (online) return <span className="font-semibold text-emerald-600 dark:text-emerald-400"> · Active now</span>;
  if (!lastSeen) return null;
  const label = lastSeenLabel(lastSeen);
  return <span> · {label.charAt(0).toUpperCase() + label.slice(1)}</span>;
}

/** Online now, the last-seen time and the shared details — read at most once a minute per person. */
function usePresenceDetails(userId: string) {
  const online = usePresence().has(userId);
  const hit = cache.get(userId);
  const [lastSeen, setLastSeen] = useState<string | null>(hit?.lastSeen ?? null);
  // Part 9: their focus / custom status and auto reply, only when THEY allow this viewer (the API applies it)
  const [details, setDetails] = useState<{ line: string | null; autoReply: string | null } | null>(hit?.details ?? null);

  // once per open chat (at most once a minute per person): the server answer carries the details for an online person too
  useEffect(() => {
    const c = cache.get(userId);
    if (c && Date.now() - c.at < CACHE_MS) {
      setLastSeen(c.lastSeen);
      setDetails(c.details);
      return;
    }
    let cancelled = false;
    void fetch(`/api/presence-status?ids=${userId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const entry = { at: Date.now(), lastSeen: (d.lastSeen?.[userId] as string | undefined) ?? null, details: d.details?.[userId] ?? null };
        cache.set(userId, entry);
        if (cancelled) return;
        setLastSeen(entry.lastSeen);
        setDetails(entry.details);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return { online, lastSeen, details };
}
