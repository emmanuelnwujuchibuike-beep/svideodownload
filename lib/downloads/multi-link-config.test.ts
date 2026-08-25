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

/**
 * The two ad placements added 2026-08-25 (owner: "add an ad slot in between
 * each multilink fetch card … and ad and trigger on the multi links fetch so
 * when is fetch a skippable ad display like an interstitial (vignette)").
 *
 * Source-level, same reason as the block above: the behaviour spans a zone
 * registry, a panel's render order and a component keyed on a state
 * transition, so there is no single unit to call.
 */
describe("Multi-Link ad placements", () => {
  const panel = read("features/downloader/multi-link/multi-link-panel.tsx");
  const fetchGate = read("features/downloader/multi-link/fetch-ad-gate.tsx");
  const schema = read("lib/monetization/ad-schema.ts");

  it("puts a slot BETWEEN cards and never after the last one", () => {
    /*
      A unit after the final card is not "between" anything — it sits at the
      bottom of the panel as filler, directly above the Download button, which
      is the one place an ad must never be. `i > 0` is what guarantees it: the
      slot renders BEFORE each card except the first, so there are always
      exactly (cards - 1) of them and never a trailing one.
    */
    expect(panel).toMatch(/\{i > 0 \? \([\s\S]{0,200}zone="multilink_between_sources"/);
  });

  it("uses AdSurface, so an unseeded zone renders nothing at all", () => {
    // AdSurface returns null until the slot confirms a creative — otherwise an
    // unconfigured site would show a labelled empty card between every source.
    expect(panel).toMatch(/<AdSurface\s+zone="multilink_between_sources"/);
  });

  it("declares the between-cards zone as taking any format", () => {
    const meta = schema.slice(schema.indexOf("multilink_between_sources: {"));
    expect(meta.slice(0, meta.indexOf("},"))).toMatch(/banner, native, AdSense unit or video/i);
  });

  it("makes the fetch vignette skippable, and the inline slot not", () => {
    // `supportsSkip` is what makes an ad row's skip_after_seconds meaningful.
    // The visitor waits through the vignette; the inline unit is furniture.
    const gate = schema.slice(schema.indexOf("multilink_fetch_gate: {"));
    expect(gate.slice(0, gate.indexOf("},"))).toMatch(/supportsSkip: true/);
    const inline = schema.slice(schema.indexOf("multilink_between_sources: {"));
    expect(inline.slice(0, inline.indexOf("},"))).toMatch(/supportsSkip: false/);
  });

  it("never prefetches either zone", () => {
    // The panel is behind a lazy gate most visitors never open — warming these
    // would spend a round trip on every cold landing visit for nothing.
    for (const zone of ["multilink_between_sources", "multilink_fetch_gate"]) {
      const block = schema.slice(schema.indexOf(`${zone}: {`));
      expect(block.slice(0, block.indexOf("},")), zone).toMatch(/prefetch: false/);
    }
  });

  it("fires the vignette once per fetch ACTION, not once per source", () => {
    /*
      Keyed on the falling edge of "anything is fetching". Firing per source
      would mean three full-screen interruptions from a single "Fetch all" tap
      — miserable, and the kind of ad density that gets a site refused (this
      project already carries three AdSense rejections).
    */
    expect(fetchGate).toMatch(/const finished = wasBusy\.current && !busy/);
    expect(panel).toMatch(/<FetchAdGate busy=\{busyFetching\}/);
  });

  it("shows no vignette when a fetch produced nothing", () => {
    // An ad on top of an error is the worst possible moment for one.
    expect(fetchGate).toMatch(/gainedResults/);
    expect(fetchGate).toMatch(/if \(!gainedResults\) return/);
  });

  it("never blocks the results — every dead end closes itself", () => {
    // The posts are already on screen underneath by the time this opens.
    expect(fetchGate).toMatch(/if \(hasAd !== true\) close\(\)/);
    expect(fetchGate).toMatch(/if \(!showAds \|\| network === "none"\) return/);
  });
});

describe("the primary action reads as primary", () => {
  /*
    Comments stripped first.

    The file DOCUMENTS the classes it moved away from — that note is worth
    keeping — so a bare `not.toMatch` over the raw source finds
    `disabled:opacity-45` in the explanation and fails on the very comment
    explaining why it is gone. These assertions are about the code, so they
    read the code.
  */
  const code = read("features/downloader/multi-link/multi-link-panel.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("is full width and full height, not a half-row strip", () => {
    /*
      Owner, 2026-08-25: "too thin and looks like a glitch and is
      unprofessional". It was h-12/text-sm with `flex-1` beside the ZIP
      button, so the panel's primary action rendered at roughly half width and
      two thirds the height of the paste box's own Download button.
    */
    expect(code).toMatch(/"inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl/);
    // Nothing in the panel splits a row with the primary action any more.
    expect(code).not.toMatch(/flex-1/);
  });

  it("uses a flat disabled surface, not a faded gradient", () => {
    // Fading a saturated gradient renders as a washed, half-drawn slab —
    // which is what "looks like a glitch" was describing.
    expect(code).toMatch(/"cursor-not-allowed bg-secondary text-muted-foreground"/);
    expect(code).not.toMatch(/disabled:opacity-45/);
  });

  it("keeps ZIP secondary — its own row, under the primary", () => {
    expect(code).toMatch(/inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border/);
  });
});

describe("the intro's description is hidden until asked for", () => {
  /*
    Owner, 2026-08-25: "hide the multilink gray description … the gray
    description occupied a lot of space in hero section … show like a display
    mock when a learn more button near the H1 is clicked, and a hide button
    should show when it display and it should auto hide after 3secs, so it
    doesnt occupy space".
  */
  const intro = read("features/downloader/multi-link/multi-link-intro.tsx");

  it("starts hidden", () => {
    expect(intro).toMatch(/const \[showDetail, setShowDetail\] = useState\(false\)/);
  });

  it("auto-hides after exactly 3 seconds", () => {
    expect(intro).toMatch(/setTimeout\(\(\) => setShowDetail\(false\), 3000\)/);
  });

  it("the same control reads Learn more, then Hide", () => {
    expect(intro).toMatch(/\{showDetail \? "Hide" : "Learn more"\}/);
  });

  it("floats above the layout so it occupies no space", () => {
    /*
      The requirement is literally "so it doesnt occupy space". A block that
      expands in place occupies space by definition and would push the paste
      box down — a layout shift on the page whose CLS was measured at 0.684
      once already.
    */
    expect(intro).toMatch(/absolute left-1\/2 top-full/);
  });

  it("keeps the heading and the chips, which were explicitly kept", () => {
    expect(intro).toMatch(/Download multiple links, all in one place\./);
    expect(intro).toMatch(/"Same platform", "Mixed platforms", "Batch download"/);
  });

  it("the timer doesn't run out while it is being read", () => {
    expect(intro).toMatch(/onMouseEnter=\{\(\) => \{[\s\S]{0,160}clearTimeout\(hideTimer\.current\)/);
  });
});
