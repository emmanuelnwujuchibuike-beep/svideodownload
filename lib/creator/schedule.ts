import "server-only";

import { cacheGet, cacheSet } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled publishing (Feature 15 · Part 9).
 *
 * ── The honest constraint, stated rather than hidden ─────────────────────
 * Vercel gives this project TWO cron slots and both are taken (`/api/cron/
 * trending` at 03:00, `/api/cron/profile-snapshots` at 03:30). Cron slots are a
 * scarce, explicitly-tracked resource here — Part 8's Momentum Engine rode an
 * existing schedule for exactly this reason. A third daily schedule is not
 * available, and a once-a-day sweep would publish a 14:00 post at 03:00 the
 * following morning, which is not scheduling, it is a delay.
 *
 * So the sweep runs two ways:
 *
 *   1. On the existing trending cron — a guaranteed daily floor.
 *   2. Opportunistically, off the back of real traffic, behind a short lock.
 *
 * (2) is what makes it feel like scheduling: the site is read continuously, so
 * a due post goes live within about a minute. The dependency is real — a site
 * with no traffic at all publishes on the daily floor — and the UI says
 * "published within a few minutes of this time", never "at".
 *
 * ── Why the lock ────────────────────────────────────────────────────────
 * Without it, every concurrent feed request would run its own sweep. The lock
 * is a cache key with a TTL, not a mutex: two requests inside the same
 * millisecond could both pass it. That is harmless — the UPDATE is idempotent
 * (it only ever moves due 'scheduled' rows to 'published') and races to the
 * same end state. Correctness does not rest on the lock; cost does.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const LOCK_KEY = "creator:schedule:sweep";
const LOCK_TTL_SECONDS = 60;

/** A ceiling, so a backlog cannot turn one request into a long-running job. */
const MAX_PER_SWEEP = 100;

/**
 * Publish every scheduled post whose time has arrived.
 * Returns how many were published — 0 is the overwhelmingly common answer.
 */
export async function sweepDueScheduledPosts(): Promise<number> {
  if (!hasSupabase) return 0;
  try {
    const db = createAdminClient();
    const now = new Date().toISOString();

    // Read the ids first so the count returned is the real number of rows
    // moved, rather than an UPDATE's row count that PostgREST would not give
    // back without a second round trip anyway.
    const { data } = await db
      .from("posts")
      .select("id")
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(MAX_PER_SWEEP);

    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return 0;

    // `created_at` is deliberately NOT rewritten to the publish moment. It is
    // the row's own creation time, several other things read it (the journey's
    // "first upload", the feed's freshness ranking, the sitemap), and quietly
    // moving it would rewrite history to make a schedule look tidy.
    const { error } = await db
      .from("posts")
      .update({ status: "published", scheduled_at: null })
      .in("id", ids)
      .eq("status", "scheduled");

    return error ? 0 : ids.length;
  } catch {
    return 0;
  }
}

/**
 * The traffic-driven entry point. Safe to call from any hot path: it returns
 * immediately when another sweep ran within the lock window, and it never
 * throws — a scheduling sweep must not be able to break a feed request.
 *
 * Call it through `after()` so the response is never waiting on it.
 */
export async function maybeSweepScheduledPosts(): Promise<void> {
  if (!hasSupabase) return;
  try {
    const held = await cacheGet<number>(LOCK_KEY);
    if (held !== null) return;
    await cacheSet(LOCK_KEY, Date.now(), LOCK_TTL_SECONDS);
    await sweepDueScheduledPosts();
  } catch {
    /* the sweep is opportunistic by definition — a failure just means the next
       request, or the daily cron, does it instead */
  }
}
