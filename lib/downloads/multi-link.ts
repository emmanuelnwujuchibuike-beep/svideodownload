import "server-only";

import { getUserPlan } from "@/lib/monetization/plan";
import { alreadyCounted, consumeDaily, peekDaily } from "@/lib/rate-limit";
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
 * `authorizeBatch` only READS the daily counter (`peekDaily` — reading an
 * allowance must never spend it), and `commitBatch` is what charges it. That
 * split is what makes spec §16 step 4 ("verify daily quota", before the ad) and
 * step 10 ("consume exactly one batch allowance", after it) both true without
 * charging a member who closed the ad and never downloaded anything.
 *
 * The refresh / multi-tab / replay hole §18 names is closed by `consumeDaily`
 * itself, not by the split: it is a single atomic Redis INCR keyed by UTC day,
 * shared across serverless instances, and the `receiptKey` is the batch id — so
 * a replayed commit for a batch already charged costs nothing, while two tabs
 * racing two DIFFERENT batches each get their own INCR and the second is
 * refused on the same counter.
 *
 * ── Fail-open, deliberately ───────────────────────────────────────────────
 * With no Upstash configured (local dev), `consumeDaily`/`peekDaily` allow
 * everything — the same philosophy as every other counter in `lib/rate-limit.ts`
 * and `lib/api/download-quota.ts`. A broken counter must never be the thing that
 * stops a download. Production configures Upstash for the cap to bite.
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

/** The daily-counter key for one identity. Signed-in follows the account across
 *  devices; signed-out falls back to IP, same identity model as every other
 *  guest allowance here (wallpapers, guest-like, reward sessions). */
function dailyKey(userId: string | null, ip: string): string {
  return `batchsess:${userId ? `u:${userId}` : `ip:${ip}`}`;
}

/**
 * Everything the client needs to draw the right limits — and nothing it is
 * trusted to enforce. Spends nothing.
 */
export async function getBatchPolicy(input: {
  userId: string | null;
  ip: string;
}): Promise<BatchPolicy> {
  const [settings, plan] = await Promise.all([
    getMultiLinkSettings(),
    getUserPlan(input.userId),
  ]);
  const dailyLimit = dailyBatchLimitFor(plan, settings);
  const used = dailyLimit === null ? 0 : await peekDaily(dailyKey(input.userId, input.ip));

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
  sourceCount: number;
  itemCount: number;
}): Promise<BatchAuthorization | BatchRefused> {
  const policy = await getBatchPolicy({ userId: input.userId, ip: input.ip });

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
  batchId: string;
}): Promise<{ allowed: boolean; used: number; remaining: number | null }> {
  const [settings, plan] = await Promise.all([
    getMultiLinkSettings(),
    getUserPlan(input.userId),
  ]);
  const limit = dailyBatchLimitFor(plan, settings);
  if (limit === null) return { allowed: true, used: 0, remaining: null };

  const key = dailyKey(input.userId, input.ip);
  const receipt = `batchsess:${input.batchId}`;

  // Already charged — a refresh or a retry of THIS batch rides the receipt
  // rather than paying twice (§18's "page refresh" / "repeated requests").
  if (await alreadyCounted(receipt)) {
    const used = await peekDaily(key);
    return { allowed: true, used, remaining: Math.max(0, limit - used) };
  }

  const r = await consumeDaily(key, limit, receipt);
  return { allowed: r.allowed, used: r.used, remaining: Math.max(0, limit - r.used) };
}
