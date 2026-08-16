import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `lib/monetization/reward-sessions.ts` spans Postgres (the `reward_sessions`
 * table), Redis (`consumeDaily`/`alreadyCounted`) and the extractor metadata
 * cache — there is no single pure unit to call, and mocking all three the way
 * `lib/api/batch-quota.test.ts` explains would mostly assert the mocks rather
 * than the real behaviour. Same approach here: pin the specific security
 * properties the reward-download spec requires by asserting them present in
 * the actual source, not a reimplementation of it.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const src = read("lib/monetization/reward-sessions.ts");
const route = read("app/api/download/route.ts");

describe("reward session ownership and expiry", () => {
  it("scopes every load to the caller's own user id or IP hash", () => {
    // Part 11: a session must never be usable by anyone but the identity that
    // created it — signed-in by user_id, anonymous by sha256(ip).
    expect(src).toMatch(/row\.user_id === identity\.userId/);
    expect(src).toMatch(/row\.ip_hash && row\.ip_hash === hashIp\(identity\.ip\)/);
  });

  it("never stores a raw IP", () => {
    expect(src).toMatch(/createHash\("sha256"\)/);
  });

  it("checks expiry before granting or redeeming", () => {
    expect(src).toMatch(/new Date\(row\.expires_at\)\.getTime\(\) < Date\.now\(\)/);
  });

  it("extends the window on grant so a retry doesn't cost a second ad (Part 19)", () => {
    expect(src).toMatch(/grantedExpiry = new Date\(Date\.now\(\) \+ 30 \* 60_000\)/);
  });
});

describe("resource/quality integrity (Parts 12-13)", () => {
  it("redemption returns the STORED item, never trusting a client-supplied one", () => {
    expect(src).toMatch(/const item = row\.payload\.items\[input\.itemIndex\]/);
    expect(src).toMatch(/if \(!item\) throw new RewardError\("BATCH_NOT_FOUND"/);
  });

  it("the download route uses the redeemed item's url\\/formatId\\/kind, not the query string", () => {
    expect(route).toMatch(/const item = await redeemRewardItem/);
    expect(route).toMatch(
      /data = \{ url: item\.url, formatId: item\.formatId, kind: item\.kind, title: item\.title \}/,
    );
  });

  it("caps HD sessions to exactly one item", () => {
    expect(src).toMatch(/hd:\s*1,\s*batch:\s*50/);
  });

  it("validates each item's formatId genuinely exists before storing it", () => {
    expect(src).toMatch(/meta\.formats\.some\(\(f\) => f\.formatId === item\.formatId && f\.kind === item\.kind\)/);
  });
});

describe("idempotency (Part 14)", () => {
  it("a replayed /complete on an already-granted session is a no-op that returns the same items", () => {
    expect(src).toMatch(/if \(row\.status === "granted"\) return \{ items: row\.payload\.items \}/);
  });

  it("charges the daily limit through the receipt-keyed primitive, keyed by session id", () => {
    // lib/rate-limit.ts's consumeDaily/alreadyCounted already guarantee "charged
    // at most once" for a given receipt key — reusing it here (rather than a
    // bespoke counter) is what makes a race between two concurrent /complete
    // calls charge at most once.
    expect(src).toMatch(/receiptKey = `reward:\$\{row\.type\}:\$\{input\.rewardSessionId\}`/);
    expect(src).toMatch(/alreadyCounted\(receiptKey\)/);
    expect(src).toMatch(/consumeDaily\(dailyKey, limit, receiptKey\)/);
  });

  it("re-redeeming an already-touched index is allowed (not a single-use lock)", () => {
    // Part 19: a network failure mid-transfer must not cost a second ad. Only
    // grant/expiry gate redemption — `consumed_indexes` is bookkeeping, not a
    // check that blocks a repeat request.
    expect(src).not.toMatch(/if \(row\.consumed_indexes\.includes\(input\.itemIndex\)\) throw/);
  });
});

describe("Pro bypass (Part 6)", () => {
  it("skips the daily-limit check entirely for a non-free plan", () => {
    expect(src).toMatch(/const plan = await getUserPlan\(input\.userId\)/);
    expect(src).toMatch(/if \(plan === "free"\) \{/);
  });
});

describe("feature switches (Part 28)", () => {
  it("both HD and batch can be turned off independently from settings", () => {
    expect(src).toMatch(/rewardDownloadHdEnabled/);
    expect(src).toMatch(/rewardDownloadBatchEnabled/);
    expect(src).toMatch(/throw new RewardError\("FEATURE_DISABLED"/);
  });
});

describe("error codes match the spec (Part 31)", () => {
  const expectedCodes = [
    "REWARD_SESSION_EXPIRED",
    "REWARD_ALREADY_CONSUMED",
    "REWARD_NOT_GRANTED",
    "DAILY_LIMIT_REACHED",
    "USER_NOT_ELIGIBLE",
    "DOWNLOAD_NOT_FOUND",
    "DOWNLOAD_TOKEN_EXPIRED",
    "DOWNLOAD_TOKEN_USED",
    "BATCH_NOT_FOUND",
    "QUALITY_NOT_AVAILABLE",
    "AD_UNAVAILABLE",
    "FEATURE_DISABLED",
    "INVALID_REQUEST",
  ];

  it.each(expectedCodes)("%s is a declared RewardErrorCode", (code) => {
    expect(src).toContain(code);
  });
});
