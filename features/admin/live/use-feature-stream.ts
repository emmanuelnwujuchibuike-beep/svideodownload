"use client";

import { useEffect, useRef, useState } from "react";

import type { EventFeature } from "@/lib/analytics/features";
import { useAdminPanelVisible } from "./panel-visibility";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE ADMIN SECTION, ONE FILTERED EVENT STREAM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "Admin → Downloads … subscribe only to the relevant
 * download event stream … When the admin leaves that section, immediately
 * unsubscribe … Avoid one global subscription that receives every FrenzSave
 * event."
 *
 * That is exactly this: a `postgres_changes` subscription on INSERT into
 * `analytics_events`, narrowed server-side by `feature=eq.<name>`, that exists
 * only while its panel is on screen.
 *
 * ── Why this is safe to run in a browser at all ─────────────────────────────
 *
 * Realtime enforces RLS on `postgres_changes`, and migration 0172 gave
 * `analytics_events` exactly one read policy: `using ((select
 * public.is_admin()))`. So a member who subscribes receives nothing — the same
 * gate as a direct read, applied to the stream.
 *
 * 🔴 IT IS ONLY THIS TABLE, AND THAT IS DELIBERATE. `scheduler.ts` records a
 * standing decision to keep the live activity feed on polling, because
 * `lib/admin/activity.ts` reads `events`, `downloads` and `profiles` through
 * the SERVICE ROLE and none of them has an admin-readable policy. Publishing
 * those to the browser to save a request would be trading a guard for a cost
 * saving, which the cost rules themselves forbid. `analytics_events` can do
 * this only because it was given a policy on purpose.
 *
 * ── Two failure modes this is shaped around ─────────────────────────────────
 *
 * 1. A Realtime topic is a GLOBAL key. `supabase.channel()` de-dupes by topic,
 *    so two panels asking for the same topic get the SAME channel object and
 *    the second `.on()` after `.subscribe()` throws. Every topic here carries
 *    the feature AND a per-mount id.
 * 2. A channel must be torn down with `supabase.removeChannel()`, not just
 *    `channel.unsubscribe()`. The client is memoised to one socket for the
 *    tab's lifetime; unsubscribing alone leaves the channel attached and the
 *    socket accumulates them — the leak that once left the messages page stuck
 *    on "connecting".
 */

export interface FeatureEvent {
  eventId: string;
  type: string;
  userId: string | null;
  path: string | null;
  at: string;
}

/**
 * Live events for one feature, newest first, capped.
 *
 * Returns `connected` so a caller can say "live" honestly rather than implying
 * it — a dead socket showing a stale list is the same lie as a confident zero.
 */
export function useFeatureStream(
  feature: EventFeature,
  { limit = 30, enabled = true }: { limit?: number; enabled?: boolean } = {},
): { events: FeatureEvent[]; connected: boolean } {
  const [events, setEvents] = useState<FeatureEvent[]>([]);
  const [connected, setConnected] = useState(false);
  /*
    The cap is read from a ref inside the handler so changing it cannot tear the
    subscription down and rebuild it — a rebuild costs a fresh WebSocket join
    and drops whatever arrived in between.
  */
  const limitRef = useRef(limit);
  limitRef.current = limit;

  /*
    🔴 The panel gate, and the whole reason the owner asked. `AdminPanel` and
    `AdminSubsections` hide a section with CSS and leave its children MOUNTED,
    so without this every section's stream would stay joined while the operator
    looked at a different one — which is the global firehose by another route.
  */
  const visible = useAdminPanelVisible();
  const active = enabled && visible;

  useEffect(() => {
    if (!active) {
      // Leaving a section clears what it had, so returning cannot show a list
      // that silently stopped updating while it was away.
      setConnected(false);
      return;
    }

    let cancelled = false;
    // Captured so cleanup can remove the exact channel it created, even if the
    // effect re-runs before the async import resolves.
    let channel: { topic: string } | null = null;
    let client: Awaited<ReturnType<typeof import("@/lib/supabase/client-lazy").getClient>> | null = null;

    void (async () => {
      const { getClient } = await import("@/lib/supabase/client-lazy");
      const supabase = await getClient();
      if (cancelled) return;
      client = supabase;

      // Feature + a random suffix: a topic is a global key, and two panels on
      // the same feature must not collide onto one channel object.
      const topic = `admin-feature:${feature}:${Math.random().toString(36).slice(2)}`;
      const ch = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "analytics_events",
            // Server-side. This is what makes it one section's stream rather
            // than every event with a filter applied after the fact.
            filter: `feature=eq.${feature}`,
          },
          (payload: { new: Record<string, unknown> }) => {
            const row = payload.new;
            const next: FeatureEvent = {
              eventId: String(row.event_id ?? ""),
              type: String(row.event_type ?? ""),
              userId: (row.user_id as string | null) ?? null,
              path: (row.path as string | null) ?? null,
              at: String(row.received_at ?? new Date().toISOString()),
            };
            setEvents((prev) => {
              // Realtime can redeliver on reconnect; event_id is the primary key.
              if (prev.some((e) => e.eventId === next.eventId)) return prev;
              return [next, ...prev].slice(0, limitRef.current);
            });
          },
        )
        .subscribe((status: string) => {
          if (!cancelled) setConnected(status === "SUBSCRIBED");
        });
      channel = ch as unknown as { topic: string };
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      // removeChannel, not unsubscribe — see the note at the top.
      if (client && channel) void client.removeChannel(channel as never);
    };
  }, [feature, active]);

  return { events, connected };
}
