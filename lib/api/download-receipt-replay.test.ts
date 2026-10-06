import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 2026-10-06 — Railway egress $7 in 2 hours.
 *
 * Production, last 3 hours: 1,049 anonymous Telegram downloads, the same posts
 * fetched up to 76 times. The daily quota's retry receipt (`t=`) let every
 * later request carrying the same id through UNCHARGED for six hours, and was
 * not bound to what was downloaded — so a caller who repeated one `t` had an
 * unlimited quota.
 *
 * The real `checkDownloadQuota` runs here against an in-memory Redis.
 */

const store = new Map<string, number>();

vi.mock("@upstash/redis", () => {
  class FakeRedis {
    static fromEnv() {
      return new FakeRedis();
    }
    async exists(k: string) {
      return store.has(k) ? 1 : 0;
    }
    async incr(k: string) {
      const v = (store.get(k) ?? 0) + 1;
      store.set(k, v);
      return v;
    }
    async expire() {
      return 1;
    }
    async set(k: string, v: number) {
      store.set(k, v);
      return "OK";
    }
  }
  return { Redis: FakeRedis };
});

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true, reset: 0 };
    }
  }
  return { Ratelimit };
});

vi.mock("@/lib/monetization/plan", () => ({
  getUserPlan: async () => "free",
  getPlanLimits: async () => ({ free: { dailyDownloads: 5 } }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake");
  vi.stubEnv("RATE_LIMIT_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

const req = () => new Request("https://frenzsave.com/api/download");

describe("a retry receipt is not a season ticket", () => {
  it("one id replayed for DIFFERENT files is charged for each — the cap holds", async () => {
    const { checkDownloadQuota } = await import("@/lib/api/download-quota");
    const allowed: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      const q = await checkDownloadQuota(req(), "9.9.9.9", "same-t", null, `https://t.me/x/${i}|tg-mt-0|video`);
      allowed.push(q.allowed);
    }
    expect(allowed.filter(Boolean)).toHaveLength(5);
  });

  it("one id replayed for the SAME file rides free only a retry's worth, then is charged", async () => {
    const { checkDownloadQuota, MAX_RETRY_RIDES } = await import("@/lib/api/download-quota");
    const allowed: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      const q = await checkDownloadQuota(req(), "9.9.9.9", "same-t", null, "https://t.me/x/848|tg-mt-0|video");
      allowed.push(q.allowed);
    }
    // the first request pays; each later one either rides (bounded) or pays — never unlimited
    expect(allowed.filter(Boolean).length).toBeLessThanOrEqual(5 * (1 + MAX_RETRY_RIDES));
    expect(allowed.at(-1)).toBe(false);
  });

  it("a genuine download's retries still cost one unit", async () => {
    const { checkDownloadQuota } = await import("@/lib/api/download-quota");
    for (let i = 0; i < 3; i++) {
      expect((await checkDownloadQuota(req(), "1.1.1.1", "t-1", null, "u|f|video")).allowed).toBe(true);
    }
    // four more distinct downloads fit in the cap of five → the retries did not spend it
    for (let i = 0; i < 4; i++) {
      expect((await checkDownloadQuota(req(), "1.1.1.1", `t-${i + 2}`, null, `u${i}|f|video`)).allowed).toBe(true);
    }
  });
});
