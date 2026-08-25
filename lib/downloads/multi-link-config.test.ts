import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MULTI_LINK,
  MAX_BATCH_ITEMS,
  dailyBatchLimitFor,
  rewardRequiredFor,
  sourceLimitFor,
} from "./multi-link-config";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("plan limits (§2)", () => {
  it("ships the spec's defaults", () => {
    expect(DEFAULT_MULTI_LINK.freeSourceLimit).toBe(3);
    expect(DEFAULT_MULTI_LINK.proSourceLimit).toBe(6);
    expect(DEFAULT_MULTI_LINK.freeDailyBatches).toBe(2);
    expect(DEFAULT_MULTI_LINK.rewardRequired).toBe(true);
    expect(DEFAULT_MULTI_LINK.proSkipsReward).toBe(true);
  });

  it("gives Pro and Business the higher source ceiling", () => {
    expect(sourceLimitFor("free")).toBe(3);
    expect(sourceLimitFor("pro")).toBe(6);
    expect(sourceLimitFor("business")).toBe(6);
  });

  it("counts a daily allowance for free only — Pro is uncapped", () => {
    expect(dailyBatchLimitFor("free")).toBe(2);
    expect(dailyBatchLimitFor("pro")).toBeNull();
    expect(dailyBatchLimitFor("business")).toBeNull();
  });

  it("requires the reward ad for free and not for Pro", () => {
    expect(rewardRequiredFor("free")).toBe(true);
    expect(rewardRequiredFor("pro")).toBe(false);
    expect(rewardRequiredFor("business")).toBe(false);
  });

  it("lets an admin make everyone watch, or nobody", () => {
    expect(rewardRequiredFor("pro", { ...DEFAULT_MULTI_LINK, proSkipsReward: false })).toBe(true);
    expect(rewardRequiredFor("free", { ...DEFAULT_MULTI_LINK, rewardRequired: false })).toBe(false);
    // The master switch wins over the Pro exemption — off means off for all.
    expect(
      rewardRequiredFor("pro", { ...DEFAULT_MULTI_LINK, rewardRequired: false, proSkipsReward: false }),
    ).toBe(false);
  });
});

describe("the item ceiling matches what the reward API accepts", () => {
  /*
    MAX_BATCH_ITEMS exists to stop the picker offering a batch the reward flow
    will reject. If these three drift apart, a member selects N items, presses
    Download, and meets a 400 — which is the worst possible moment to discover
    a limit. Asserted against the real sources rather than restated here.
  */
  it("equals MAX_ITEMS.batch in reward-sessions.ts", () => {
    const src = read("lib/monetization/reward-sessions.ts");
    const match = src.match(/MAX_ITEMS:\s*Record<RewardType,\s*number>\s*=\s*\{[^}]*batch:\s*(\d+)/);
    expect(match?.[1], "MAX_ITEMS.batch not found in reward-sessions.ts").toBeDefined();
    expect(Number(match![1])).toBe(MAX_BATCH_ITEMS);
  });

  it("equals the zod cap on /api/rewards/download/start", () => {
    const src = read("app/api/rewards/download/start/route.ts");
    const match = src.match(/items:\s*z\.array\(itemSchema\)\.min\(1\)\.max\((\d+)\)/);
    expect(match?.[1], "items cap not found on the reward start route").toBeDefined();
    expect(Number(match![1])).toBe(MAX_BATCH_ITEMS);
  });
});

/**
 * The security properties, asserted at the source level.
 *
 * Same approach — and for the same reason — as `lib/api/batch-quota.test.ts`:
 * the behaviour spans a client panel, three API routes and a Redis-backed
 * counter, so there is no single unit to call, and a test that mocked all four
 * would only be asserting the mocks.
 */
describe("the backend is the final authority (§18, §19, §36)", () => {
  const policy = read("lib/downloads/multi-link.ts");
  const authorize = read("app/api/downloads/batch/authorize/route.ts");
  const commit = read("app/api/downloads/batch/commit/route.ts");
  const panel = read("features/downloader/multi-link/multi-link-panel.tsx");

  it("re-derives the plan server-side instead of trusting the request", () => {
    // No `isPro` / `plan` field is read off the body anywhere in the flow.
    expect(policy).toMatch(/getUserPlan\(input\.userId\)/);
    expect(authorize).not.toMatch(/body.*\bisPro\b|parsed\.data\.plan/);
    expect(commit).not.toMatch(/parsed\.data\.plan/);
  });

  it("re-derives the source ceiling from that plan", () => {
    expect(policy).toMatch(/sourceLimit:\s*sourceLimitFor\(plan, settings\)/);
    expect(policy).toMatch(/input\.sourceCount > policy\.sourceLimit/);
  });

  it("mints the batch id on the server, never accepting one from the client", () => {
    // A client-chosen id could replay a spent receipt, or mint a fresh one per
    // item and never be charged at all.
    expect(authorize).toMatch(/const batchId = crypto\.randomUUID\(\)/);
    expect(authorize).not.toMatch(/batchId:\s*z\./);
    expect(panel).not.toMatch(/batchId = crypto\.randomUUID/);
  });

  it("reads the allowance without spending it, and spends it exactly once", () => {
    // peek at authorize time (§16 step 4), consume at commit time (step 10),
    // with the batch id as the receipt so a replay charges nothing.
    expect(policy).toMatch(/const used = dailyLimit === null \? 0 : await peekDaily/);
    expect(policy).toMatch(/const receipt = `batchsess:\$\{input\.batchId\}`/);
    expect(policy).toMatch(/consumeDaily\(key, limit, receipt\)/);
    expect(policy).toMatch(/alreadyCounted\(receipt\)/);
  });

  it("never charges Pro or Business a batch allowance", () => {
    expect(policy).toMatch(/if \(limit === null\) return \{ allowed: true/);
  });

  it("collapses duplicate sources before counting them", () => {
    // Otherwise one link pasted three times spends a free member's whole
    // source allowance on one post.
    expect(authorize).toMatch(/new Set\(parsed\.data\.sources\.map/);
    expect(authorize).toMatch(/sourceCount: uniqueSources\.size/);
  });

  it("shows no ad when there is no allowance left (§20)", () => {
    // The gate is only reached through a successful /authorize, and authorize
    // refuses on a spent allowance before any reward session is opened.
    expect(policy).toMatch(/policy\.remaining !== null && policy\.remaining <= 0/);
    expect(panel).toMatch(/if \(!res\.ok\)/);
  });
});

describe("the batch rides the existing reward + quota machinery (§45, §46)", () => {
  const panel = read("features/downloader/multi-link/multi-link-panel.tsx");

  it("reuses BatchAdGate rather than a second ad policy", () => {
    expect(panel).toMatch(/from "@\/features\/downloader\/batch-ad-gate"/);
    expect(panel).toMatch(/<BatchAdGate/);
  });

  it("reuses the download manager rather than a second queue", () => {
    expect(panel).toMatch(/startDownload as enqueueDownload/);
    expect(panel).not.toMatch(/MAX_CONCURRENT|new Semaphore/);
  });

  it("redeems through the reward token, never a re-sent formatId", () => {
    // The server substitutes what IT stored for this index — that substitution
    // is the whole security property of the reward flow.
    expect(panel).toMatch(
      /rewardToken=\$\{encodeURIComponent\(reward\.auth\.rewardSessionId\)\}&itemIndex=\$\{rewardIndex\}/,
    );
  });

  it("retries at the item's ORIGINAL index in the reward session", () => {
    /*
      `redeemRewardItem` returns `payload.items[itemIndex]` from the stored,
      ordered list. Re-indexing a 3-item retry as 0,1,2 would hand back the
      first three items of the original batch instead of the three that
      failed — silently downloading the wrong files with a valid token.
    */
    expect(panel).toMatch(/indexById: new Map\(items\.map\(\(it, i\) => \[it\.id, i\]\)\)/);
    expect(panel).toMatch(/const rewardIndex = reward\?\.indexById\.get\(item\.id\)/);
  });

  it("a retry costs neither a second allowance nor a second ad", () => {
    // It re-runs items inside a batch that has already been paid for.
    expect(panel).toMatch(/isRetry = false/);
    expect(panel).toMatch(/if \(!isRetry\) \{/);
    expect(panel).toMatch(/runBatch\(toRetry, null, state\.batchId, true\)/);
  });

  it("charges the daily DOWNLOAD cap once for the whole batch", () => {
    // One `batchId` on every task ⇒ one `b=` receipt ⇒ one charge, exactly as
    // a single slideshow already does.
    expect(panel).toMatch(/batchId,/);
  });
});
