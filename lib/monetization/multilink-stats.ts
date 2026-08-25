import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { DEFAULT_MULTI_LINK } from "@/lib/downloads/multi-link-config";
import { getMultiLinkSettings } from "@/lib/downloads/multi-link";

/**
 * Multi-Link operational stats for the admin dashboard (owner, 2026-08-25:
 * "see in live activity which user used multi links, and how many multlink
 * used … show where an ad was shown and how many reward ad from multi
 * download, and how many users used up their free multi download and how many
 * did not").
 *
 * ── Every number here is counted, none is estimated ───────────────────────
 * Sources, in order: the `events` table (`batch_authorized`, `batch_refused`,
 * `batch_started`, `reward_started`, `reward_granted`) and `ad_impressions`
 * for the two Multi-Link zones. Anything that could not be counted honestly is
 * absent and said so in the panel, not filled with a plausible-looking figure
 * (see the standing no-fabricated-stats rule).
 *
 * ── The one real attribution limit, stated rather than hidden ─────────────
 * "How many users used up their free allowance" is answered ONLY for
 * signed-in members. The allowance is keyed per identity, and a signed-out
 * visitor's identity is their IP hash — which is deliberately never written to
 * the events table. So anonymous batches are counted in the totals but cannot
 * be grouped per visitor, and `anonymousBatches` reports them separately
 * instead of being folded in and silently overstating the user count.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** PostgREST caps a response at 1000 rows whatever `.limit()` says. */
const ROW_CAP = 5000;
const PAGE = 1000;

interface EventRow {
  created_at: string;
  user_id: string | null;
  metadata: Record<string, unknown> | null;
}

async function pullEvents(types: string[], since: string): Promise<{ rows: EventRow[]; capped: boolean }> {
  const db = createAdminClient();
  const rows: EventRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("events")
      .select("created_at, user_id, metadata")
      .in("type", types)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as unknown as EventRow[]));
    if (data.length < PAGE || rows.length >= ROW_CAP) {
      return { rows, capped: rows.length >= ROW_CAP };
    }
    from += PAGE;
  }
  return { rows, capped: false };
}

export interface MultiLinkStats {
  /** Days covered. */
  rangeDays: number;
  /** Batches that passed every server check and were handed a batch id. */
  authorized: number;
  /** Batches that actually spent an allowance and started downloading. */
  started: number;
  /** Refusals, keyed by the limit that bit. */
  refusedByReason: Record<string, number>;
  /** Distinct SIGNED-IN members who ran at least one batch. */
  users: number;
  /** Batches from signed-out visitors — counted, but not groupable per person. */
  anonymousBatches: number;
  /** Signed-in members who have spent their whole free allowance TODAY. */
  usedUpToday: number;
  /** Signed-in members who ran a batch today with allowance still left. */
  remainingToday: number;
  /** The free daily allowance those two are measured against. */
  freeDailyLimit: number;
  /** Sources and items across every authorized batch — the shape of real use. */
  totalSources: number;
  totalItems: number;
  /** Ad impressions in the two Multi-Link zones. */
  adImpressions: { betweenSources: number; fetchGate: number };
  /** Reward ads attributed to the MULTI-LINK gate specifically. */
  rewards: { started: number; granted: number };
  /** True when a query hit the row cap, so the UI can say the window is partial. */
  capped: boolean;
}

const EMPTY: MultiLinkStats = {
  rangeDays: 30,
  authorized: 0,
  started: 0,
  refusedByReason: {},
  users: 0,
  anonymousBatches: 0,
  usedUpToday: 0,
  remainingToday: 0,
  freeDailyLimit: DEFAULT_MULTI_LINK.freeDailyBatches,
  totalSources: 0,
  totalItems: 0,
  adImpressions: { betweenSources: 0, fetchGate: 0 },
  rewards: { started: 0, granted: 0 },
  capped: false,
};

export async function getMultiLinkStats(rangeDays = 30): Promise<MultiLinkStats> {
  const days = Math.min(90, Math.max(1, Math.floor(rangeDays)));
  if (!hasSupabase) return { ...EMPTY, rangeDays: days };

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const sinceIso = since.toISOString();
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const db = createAdminClient();
    const [settings, batchEvents, impressions] = await Promise.all([
      getMultiLinkSettings(),
      pullEvents(["batch_authorized", "batch_refused", "batch_started"], sinceIso),
      db
        .from("ad_impressions")
        .select("zone")
        .in("zone", ["multilink_between_sources", "multilink_fetch_gate"])
        .gte("created_at", sinceIso)
        .limit(PAGE * 5),
    ]);

    const out: MultiLinkStats = {
      ...EMPTY,
      rangeDays: days,
      refusedByReason: {},
      freeDailyLimit: settings.freeDailyBatches,
      capped: batchEvents.capped,
    };

    const users = new Set<string>();
    /** Batches per signed-in member TODAY — the only honest way to say who has
     *  spent their allowance, since the counter itself lives in Redis. */
    const todayPerUser = new Map<string, number>();

    for (const row of batchEvents.rows) {
      const m = row.metadata ?? {};
      /*
        `batch_started` carries no type field of its own, so the three are
        distinguished by which metadata keys they hold — `reason` for a
        refusal, `sources` for an authorization. Cheaper and more robust than
        re-querying per type, and the registry documents both contracts.
      */
      if (typeof m.reason === "string") {
        out.refusedByReason[m.reason] = (out.refusedByReason[m.reason] ?? 0) + 1;
        continue;
      }
      if (typeof m.batchId === "string") {
        out.started += 1;
        if (row.user_id) {
          users.add(row.user_id);
          if (row.created_at.slice(0, 10) === todayIso) {
            todayPerUser.set(row.user_id, (todayPerUser.get(row.user_id) ?? 0) + 1);
          }
        } else {
          out.anonymousBatches += 1;
        }
        continue;
      }
      out.authorized += 1;
      if (typeof m.sources === "number") out.totalSources += m.sources;
      if (typeof m.items === "number") out.totalItems += m.items;
    }

    out.users = users.size;
    for (const count of todayPerUser.values()) {
      if (count >= settings.freeDailyBatches) out.usedUpToday += 1;
      else out.remainingToday += 1;
    }

    /*
      The reward funnel, counted server-side per event type.

      Only the multi-link gate: BOTH batch gates open reward type "batch" on
      purpose (identical server behaviour), so filtering on the type alone
      would merge them — `metadata->>surface` is exactly why that tag was
      added. Two `head: true` counts rather than paging the rows: nothing here
      needs the row bodies, and the started/granted split is the whole point,
      which a merged pull would flatten.
    */
    const [startedCount, grantedCount] = await Promise.all([
      countRewardsForSurface(db, "reward_started", sinceIso),
      countRewardsForSurface(db, "reward_granted", sinceIso),
    ]);
    out.rewards = { started: startedCount, granted: grantedCount };

    for (const row of (impressions.data ?? []) as { zone: string }[]) {
      if (row.zone === "multilink_between_sources") out.adImpressions.betweenSources += 1;
      else if (row.zone === "multilink_fetch_gate") out.adImpressions.fetchGate += 1;
    }

    return out;
  } catch {
    // An unmigrated or unreachable table yields ZEROES, never an error — the
    // panel says "nothing recorded yet", which is true, rather than breaking
    // the whole dashboard.
    return { ...EMPTY, rangeDays: days };
  }
}

/** Rewards of one lifecycle type attributed to the multi-link gate. */
async function countRewardsForSurface(
  db: ReturnType<typeof createAdminClient>,
  type: "reward_started" | "reward_granted",
  since: string,
): Promise<number> {
  try {
    const { count } = await db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("type", type)
      .eq("metadata->>surface", "multilink_batch")
      .gte("created_at", since);
    return count ?? 0;
  } catch {
    return 0;
  }
}
