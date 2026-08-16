import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Sliding-window rate limiter backed by Upstash Redis.
 *
 * If Upstash env vars are absent (e.g. local dev), we fall back to an
 * in-memory limiter so the app still runs — but production MUST configure
 * Upstash for the limit to be shared across serverless instances.
 */

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

// Rate limiting is OPT-OUT: set RATE_LIMIT_ENABLED=false (or "0") for unlimited
// downloads with no per-user throttling. When enabled, per-window token counts
// are configurable so you can tune for your traffic profile.
const rateLimitEnabled = !["false", "0", "off"].includes(
  (process.env.RATE_LIMIT_ENABLED || "true").toLowerCase(),
);

const METADATA_TOKENS = Number(process.env.RATE_LIMIT_METADATA_PER_MIN || 60);
const DOWNLOAD_TOKENS = Number(process.env.RATE_LIMIT_DOWNLOAD_PER_MIN || 30);
const ASSISTANT_TOKENS = Number(process.env.RATE_LIMIT_ASSISTANT_PER_MIN || 15);
// Chat is rapid human back-and-forth, not AI-usage — much higher than assistantLimiter.
const MESSAGE_TOKENS = Number(process.env.RATE_LIMIT_MESSAGE_PER_MIN || 30);

type LimitResult = { success: boolean; remaining: number; reset: number };

interface Limiter {
  limit(identifier: string): Promise<LimitResult>;
}

/** Always-allow limiter used when rate limiting is disabled ("unlimited"). */
const noopLimiter: Limiter = {
  async limit() {
    return { success: true, remaining: Number.MAX_SAFE_INTEGER, reset: 0 };
  },
};

function createUpstashLimiter(tokens: number, window: `${number} ${"s" | "m" | "h"}`): Limiter {
  const redis = Redis.fromEnv();
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: "svd:rl",
    analytics: true,
  });
  return {
    async limit(id) {
      const r = await rl.limit(id);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
  };
}

/** Minimal in-memory limiter for local development only. */
function createMemoryLimiter(tokens: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(id) {
      const now = Date.now();
      const windowStart = now - windowMs;
      const timestamps = (hits.get(id) || []).filter((t) => t > windowStart);
      timestamps.push(now);
      hits.set(id, timestamps);
      const remaining = Math.max(0, tokens - timestamps.length);
      return {
        success: timestamps.length <= tokens,
        remaining,
        reset: now + windowMs,
      };
    },
  };
}

function buildLimiter(tokens: number): Limiter {
  if (!rateLimitEnabled) return noopLimiter;
  return hasUpstash
    ? createUpstashLimiter(tokens, "1 m")
    : createMemoryLimiter(tokens, 60_000);
}

export const metadataLimiter: Limiter = buildLimiter(METADATA_TOKENS);
export const downloadLimiter: Limiter = buildLimiter(DOWNLOAD_TOKENS);
export const assistantLimiter: Limiter = buildLimiter(ASSISTANT_TOKENS);
export const messageLimiter: Limiter = buildLimiter(MESSAGE_TOKENS);
// Sign-in codes: strict — every request sends a real email, and brute-force
// resistance matters more than convenience here.
export const otpLimiter: Limiter = buildLimiter(Number(process.env.RATE_LIMIT_OTP_PER_MIN || 4));
// Tracking pixels fire often but must resist fake-click floods.
export const trackLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_TRACK_PER_MIN || 120),
);

// Part 11a — account security. All strict: brute-force resistance matters
// far more than convenience for PIN/recovery-code/passkey verification.
export const securityEventLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_SECURITY_EVENT_PER_MIN || 20),
);
export const recoveryCodeLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_RECOVERY_CODE_PER_MIN || 5),
);
export const pinLimiter: Limiter = buildLimiter(Number(process.env.RATE_LIMIT_PIN_PER_MIN || 8));
export const passkeyLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_PASSKEY_PER_MIN || 10),
);
export const deviceLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_DEVICE_PER_MIN || 20),
);

// Reward-gated downloads (HD/batch unlock). Starting a session is cheap to spam
// (no ad shown yet), so it gets the tighter bound; completing one is rarer and
// already gated behind actually watching something.
export const rewardStartLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_REWARD_START_PER_MIN || 20),
);
export const rewardCompleteLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_REWARD_COMPLETE_PER_MIN || 20),
);

/**
 * Per-day counter for enforcing daily caps (downloads per plan). Uses a single
 * Redis INCR keyed by UTC day so the cap is shared across serverless instances.
 *
 * Fail-open: if rate limiting is disabled or Upstash isn't configured (local
 * dev), it always allows — same philosophy as the windowed limiters, so a
 * missing Redis never hard-blocks real users. Production must configure Upstash
 * for the daily cap to actually bite.
 */
const dailyRedis = rateLimitEnabled && hasUpstash ? Redis.fromEnv() : null;

export interface DailyResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Today's count for a daily key, WITHOUT spending anything.
 *
 * For interfaces that want to say "3 left today" before someone commits to an
 * action. Reading an allowance must never consume it — a page that charged a
 * download just by rendering would be the same class of bug as the runaway
 * counter this module is recovering from.
 */
export async function peekDaily(key: string): Promise<number> {
  if (!dailyRedis) return 0;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const v = await dailyRedis.get<number | string>(`svd:daily2:${day}:${key}`);
    const n = typeof v === "string" ? Number.parseInt(v, 10) : v;
    return Number.isFinite(n) && n ? Number(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * Has this exact unit of work already been counted against a daily cap?
 *
 * The companion to `consumeDaily`'s `receiptKey`. A retry asks this first and,
 * on a hit, spends nothing — see the note in `checkDownloadQuota` for why that
 * matters: without it, an automatic retry silently multiplies what a person's
 * daily allowance costs them.
 *
 * Fail-open, like everything else here. If Redis is unreachable the answer is
 * "no receipt", the caller falls through to `consumeDaily`, and that fails open
 * too — a broken counter must never be what stops a download.
 */
export async function alreadyCounted(receiptKey: string): Promise<boolean> {
  if (!dailyRedis) return false;
  try {
    return (await dailyRedis.exists(`svd:receipt:${receiptKey}`)) === 1;
  } catch {
    return false;
  }
}

export async function consumeDaily(
  key: string,
  limit: number,
  /**
   * When given, a receipt is written on a SUCCESSFUL charge so the same unit of
   * work can be recognised later and not charged twice. Deliberately not
   * written when the charge is refused — otherwise a retry could ride a receipt
   * it never paid for and slip past the cap.
   */
  receiptKey?: string,
): Promise<DailyResult> {
  if (!dailyRedis || limit <= 0) {
    return { allowed: true, used: 0, limit, remaining: limit };
  }
  try {
    const day = new Date().toISOString().slice(0, 10); // UTC date
    /*
      🔴 `daily2`, not `daily` (2026-08-09).

      The counters under the old prefix are KNOWN CORRUPT. For part of a day,
      auto-retry spent up to three units per download and then retried the
      resulting 429s, spending three more per failure — so the recorded tallies
      bear no relation to what anyone actually downloaded, and they are keyed by
      UTC day, meaning everyone affected stayed locked out until midnight.

      Renaming the namespace discards them at deploy time and starts every
      visitor from zero. That is the right remedy specifically because the
      inflation was OUR fault: leaving people to serve out a lockout earned by
      our bug would be charging them for it. The old keys expire on their own
      26-hour TTL.
    */
    const rk = `svd:daily2:${day}:${key}`;
    const used = await dailyRedis.incr(rk);
    if (used === 1) {
      // Expire ~26h after first hit so the bucket self-cleans the next UTC day.
      await dailyRedis.expire(rk, 60 * 60 * 26);
    }
    const allowed = used <= limit;
    if (allowed && receiptKey) {
      // Six hours: comfortably longer than any download plus its retries, far
      // shorter than the daily bucket, so receipts never outlive their purpose.
      await dailyRedis.set(`svd:receipt:${receiptKey}`, 1, { ex: 60 * 60 * 6 });
    }
    return { allowed, used, limit, remaining: Math.max(0, limit - used) };
  } catch {
    // Never block a download because the counter backend hiccupped.
    return { allowed: true, used: 0, limit, remaining: limit };
  }
}

/**
 * A generic short-lived counter, for behaviour a table cannot remember.
 *
 * Added for repost repeat-detection: a repost row is DELETED on undo, so
 * "reposted and removed this four times" leaves no trace in Postgres to count.
 * Writing an audit table for it would keep a permanent record of something a
 * member deliberately undid, which is worse than not detecting it — so the
 * count lives in Redis with a TTL and disappears on its own.
 *
 * Fails to 0 (= "no history"), like everything else here. A missing Redis must
 * never be what refuses a legitimate action.
 */
export async function bumpEphemeralCount(key: string, ttlSeconds: number): Promise<number> {
  if (!dailyRedis) return 0;
  try {
    const rk = `svd:count:${key}`;
    const n = await dailyRedis.incr(rk);
    if (n === 1) await dailyRedis.expire(rk, ttlSeconds);
    return n;
  } catch {
    return 0;
  }
}

/** Read a short-lived counter without spending anything. */
export async function peekEphemeralCount(key: string): Promise<number> {
  if (!dailyRedis) return 0;
  try {
    const v = await dailyRedis.get<number | string>(`svd:count:${key}`);
    const n = typeof v === "string" ? Number.parseInt(v, 10) : v;
    return Number.isFinite(n) && n ? Number(n) : 0;
  } catch {
    return 0;
  }
}

/** Derives a best-effort client identifier from request headers. */
export function clientId(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") || "anonymous";
}
