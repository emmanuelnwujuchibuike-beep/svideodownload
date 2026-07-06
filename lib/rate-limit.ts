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
// Sign-in codes: strict — every request sends a real email, and brute-force
// resistance matters more than convenience here.
export const otpLimiter: Limiter = buildLimiter(Number(process.env.RATE_LIMIT_OTP_PER_MIN || 4));
// Tracking pixels fire often but must resist fake-click floods.
export const trackLimiter: Limiter = buildLimiter(
  Number(process.env.RATE_LIMIT_TRACK_PER_MIN || 120),
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

export async function consumeDaily(key: string, limit: number): Promise<DailyResult> {
  if (!dailyRedis || limit <= 0) {
    return { allowed: true, used: 0, limit, remaining: limit };
  }
  try {
    const day = new Date().toISOString().slice(0, 10); // UTC date
    const rk = `svd:daily:${day}:${key}`;
    const used = await dailyRedis.incr(rk);
    if (used === 1) {
      // Expire ~26h after first hit so the bucket self-cleans the next UTC day.
      await dailyRedis.expire(rk, 60 * 60 * 26);
    }
    return { allowed: used <= limit, used, limit, remaining: Math.max(0, limit - used) };
  } catch {
    // Never block a download because the counter backend hiccupped.
    return { allowed: true, used: 0, limit, remaining: limit };
  }
}

/** Derives a best-effort client identifier from request headers. */
export function clientId(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") || "anonymous";
}
