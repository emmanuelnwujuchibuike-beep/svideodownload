import "server-only";

import { createHash } from "node:crypto";

import { getUserPlan } from "@/lib/monetization/plan";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  DEFAULT_MULTI_LINK,
  MAX_BATCH_ITEMS,
  dailyBatchLimitFor,
  rewardRequiredFor,
  sourceLimitFor,
  type BatchPolicy,
  type MultiLinkSettings,
} from "./multi-link-config";

/**
 * Multi-Link Batch Downloader — server-side policy and quota.
 *
 * ── The backend is the final authority (spec §36) ─────────────────────────
 * Every limit the UI draws is re-derived here from the caller's real,
 * server-resolved plan. The client's own idea of `isPro`, its source count and
 * its daily counter are all treated as decoration: `authorizeBatch()` recomputes
 * the source ceiling from `getUserPlan()` and refuses anything past it, so a
 * forged request claiming Pro with 100 links is rejected on the same line that
 * would have rejected a free member's 4th.
 *
 * ── Why the allowance is spent in a SECOND call ───────────────────────────
 * `authorizeBatch` only READS the allowance, and `commitBatch` is what charges
 * it. That split is what makes spec §16 step 4 ("verify daily quota", before
 * the ad) and step 10 ("consume exactly one batch allowance", after it) both
 * true without charging a member who closed the ad and never downloaded.
 *
 * ── 🔴 The counter is POSTGRES, not the Redis daily helper ────────────────
 * It used to be `consumeDaily`, which fails open when Upstash is unconfigured —
 * and those env vars are present but EMPTY here, so it always did: the panel
 * showed a constant "2 remaining" forever (owner, 2026-08-25). Fail-open is
 * right for a DOWNLOAD and wrong for an allowance the UI prints back to the
 * visitor. See `batchesUsedToday` and migration 0134.
 *
 * The refresh / multi-tab / replay hole §18 names is closed by the UNIQUE
 * constraint on `batch_sessions.batch_id` — a replayed commit conflicts and is
 * ignored, enforced by the database rather than by application logic.
 */

export * from "./multi-link-config";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: MultiLinkSettings } | null = null;

/** Admin-configured settings, cached for a minute (same shape as `getMomentumSettings`). */
export async function getMultiLinkSettings(): Promise<MultiLinkSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  if (!hasSupabase) return DEFAULT_MULTI_LINK;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "multi_link")
      .maybeSingle();
    const merged = {
      ...DEFAULT_MULTI_LINK,
      ...((data?.value ?? {}) as Partial<MultiLinkSettings>),
    };
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_MULTI_LINK;
  }
}

export async function setMultiLinkSettings(s: MultiLinkSettings): Promise<void> {
  await createAdminClient()
    .from("settings")
    .upsert({ key: "multi_link", value: s }, { onConflict: "key" });
  cache = null;
}

/** Start of the current UTC day — the window the allowance resets on. */
function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Batches this identity has committed today.
 *
 * 🔴 Reads Postgres, NOT the Redis daily counter (owner, 2026-08-25: "the
 * daily limit in the multi link doesnt work, it just shows a constant you have
 * 2 remaining").
 *
 * `consumeDaily` fails open when Upstash is unconfigured — returning
 * `used: 0` — and `UPSTASH_REDIS_REST_URL`/`_TOKEN` are present but EMPTY, so
 * it always did. That behaviour is correct for a download (a broken counter
 * must never stop someone getting their file) and wrong for an allowance the
 * UI shows back to the visitor, where it prints a number that never moves and
 * quietly gives the feature away.
 *
 * The database is already a hard dependency of this feature — plan resolution,
 * settings and reward sessions all need it, so there is no batch to authorize
 * without it. Counting here cannot silently no-op.
 */
async function batchesUsedToday(userId: string | null, anonId: string | null): Promise<number> {
  if (!hasSupabase) return 0;
  if (!userId && !anonId) return 0;
  try {
    const db = createAdminClient();
    const q = db
      .from("batch_sessions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfUtcDay());
    const { count } = await (userId
      ? q.eq("user_id", userId)
      : q.eq("anon_id", anonId!));
    return count ?? 0;
  } catch {
    /*
      A read failure reports ZERO used, i.e. full allowance.

      Deliberate, and the one place the old fail-open instinct is still right:
      refusing a batch because a COUNT query hiccuped would take a paid-for ad
      and deliver nothing. The write below is what actually enforces the cap,
      and it has the unique constraint behind it.
    */
    return 0;
  }
}

/** sha256(ip) — never the raw address, same as reward_sessions. */
function hashIdentityIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

/**
 * Everything the client needs to draw the right limits — and nothing it is
 * trusted to enforce. Spends nothing.
 */
export async function getBatchPolicy(input: {
  userId: string | null;
  ip: string;
  /** The browser identity for a signed-out visitor — see batch-identity.ts. */
  anonId?: string | null;
}): Promise<BatchPolicy> {
  const [settings, plan] = await Promise.all([
    getMultiLinkSettings(),
    getUserPlan(input.userId),
  ]);
  const dailyLimit = dailyBatchLimitFor(plan, settings);
  const used = dailyLimit === null ? 0 : await batchesUsedToday(input.userId, input.anonId ?? null);

  return {
    enabled: settings.enabled,
    plan,
    sourceLimit: sourceLimitFor(plan, settings),
    maxItems: MAX_BATCH_ITEMS,
    rewardRequired: rewardRequiredFor(plan, settings),
    dailyLimit,
    used,
    remaining: dailyLimit === null ? null : Math.max(0, dailyLimit - used),
    fetchConcurrency: Math.max(1, Math.min(6, settings.fetchConcurrency)),
    upsellMessage: settings.upsellMessage,
  };
}

export type BatchRefusal =
  | "FEATURE_DISABLED"
  | "TOO_MANY_SOURCES"
  | "TOO_MANY_ITEMS"
  | "DAILY_LIMIT_REACHED";

export interface BatchAuthorization {
  ok: true;
  policy: BatchPolicy;
}
export interface BatchRefused {
  ok: false;
  reason: BatchRefusal;
  message: string;
  policy: BatchPolicy;
}

/**
 * Step 4 of §16: may this caller run a batch of this shape at all?
 *
 * Checks the feature switch, the SERVER-resolved source ceiling, the item
 * ceiling the reward flow will accept, and the remaining daily allowance —
 * without spending any of it. A refusal here is why "do not show an ad when
 * the user has no remaining batch allowance" (§20) holds: the gate never
 * opens.
 */
export async function authorizeBatch(input: {
  userId: string | null;
  ip: string;
  anonId?: string | null;
  sourceCount: number;
  itemCount: number;
}): Promise<BatchAuthorization | BatchRefused> {
  const policy = await getBatchPolicy({ userId: input.userId, ip: input.ip, anonId: input.anonId });

  if (!policy.enabled) {
    return {
      ok: false,
      reason: "FEATURE_DISABLED",
      message: "Batch downloading is currently unavailable.",
      policy,
    };
  }
  if (input.sourceCount < 1 || input.sourceCount > policy.sourceLimit) {
    return {
      ok: false,
      reason: "TOO_MANY_SOURCES",
      message: `Your plan supports up to ${policy.sourceLimit} sources per batch.`,
      policy,
    };
  }
  if (input.itemCount < 1 || input.itemCount > policy.maxItems) {
    return {
      ok: false,
      reason: "TOO_MANY_ITEMS",
      message: `A batch can carry up to ${policy.maxItems} items.`,
      policy,
    };
  }
  if (policy.remaining !== null && policy.remaining <= 0) {
    return {
      ok: false,
      reason: "DAILY_LIMIT_REACHED",
      message: `You've reached today's ${policy.dailyLimit} free batch downloads.`,
      policy,
    };
  }
  return { ok: true, policy };
}

/**
 * Step 10 of §16: spend exactly one batch allowance.
 *
 * Idempotent per `batchId` — a page refresh mid-batch, a retried commit, or a
 * second call from a component that re-mounted all resolve to the same receipt
 * and charge once. Pro/Business are never counted at all.
 */
export async function commitBatch(input: {
  userId: string | null;
  ip: string;
  anonId?: string | null;
  batchId: string;
}): Promise<{ allowed: boolean; used: number; remaining: number | null }> {
  const [settings, plan] = await Promise.all([
    getMultiLinkSettings(),
    getUserPlan(input.userId),
  ]);
  const limit = dailyBatchLimitFor(plan, settings);
  if (limit === null) return { allowed: true, used: 0, remaining: null };
  if (!hasSupabase) return { allowed: true, used: 0, remaining: limit };

  const db = createAdminClient();

  /*
    Idempotency is the UNIQUE constraint on `batch_id`, not application logic.

    A replayed commit — refresh mid-batch, a retried request, a re-mounted
    component — conflicts and is ignored, so the row count (and therefore the
    allowance) is unchanged. `ignoreDuplicates` makes that a no-op rather than
    an error, which is what lets this be called freely.
  */
  /*
    🔴 THE ERROR IS READ, NOT JUST THE THROW (2026-08-26).

    This used to be a bare `await` in a try/catch, and a PostgREST rejection is
    not a throw — it is a resolved promise carrying `{ error }`. So when
    `anon_id` turned out not to exist on the deployed table (0138), every
    single upsert was rejected, the catch never ran, and the code below happily
    counted a table that had never received a row. Result: "0 used, 2 remaining"
    forever, and a daily cap that was never once enforced.

    Both failure shapes now land in the same place, and neither is allowed to
    report a clean full allowance.
  */
  let recorded = true;
  try {
    const { error } = await db
      .from("batch_sessions")
      .upsert(
        {
          batch_id: input.batchId,
          user_id: input.userId,
          anon_id: input.userId ? null : (input.anonId ?? null),
          // Recorded for a future abuse control, never the counting key.
          ip_hash: input.userId ? null : hashIdentityIp(input.ip),
        },
        { onConflict: "batch_id", ignoreDuplicates: true },
      );
    if (error) recorded = false;
  } catch {
    recorded = false;
  }

  if (!recorded) {
    /*
      Allow the batch — the ad was already watched, and taking someone's
      payment and delivering nothing is the worse failure. But do NOT hand back
      a full allowance as though the write had succeeded: report whatever the
      table can still be read for, so a broken write shows up as a counter that
      stops moving rather than one that silently resets to full every time.
    */
    const known = await batchesUsedToday(input.userId, input.anonId ?? null);
    return { allowed: true, used: known, remaining: Math.max(0, limit - known) };
  }

  const used = await batchesUsedToday(input.userId, input.anonId ?? null);
  return {
    // `used` INCLUDES the row just written, so the Nth batch of an N-limit day
    // is still allowed and the (N+1)th is not.
    allowed: used <= limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}
