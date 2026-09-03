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
    // Read at authorize time (§16 step 4), write at commit time (step 10).
    expect(policy).toMatch(/const used = dailyLimit === null \? 0 : await batchesUsedToday/);
    // Exactly-once is the UNIQUE constraint on batch_id, not application logic.
    expect(policy).toMatch(/onConflict: "batch_id", ignoreDuplicates: true/);
  });

  it("🔴 counts in Postgres, never through the fail-open Redis counter", () => {
    /*
      The bug this replaced (owner: "the daily limit in the multi link doesnt
      work, it just shows a constant you have 2 remaining"): `consumeDaily`
      returns `{ allowed: true, used: 0 }` when Upstash is unconfigured, and
      `UPSTASH_REDIS_REST_URL`/`_TOKEN` are present but EMPTY — so the counter
      never counted and the panel faithfully printed a number that never moved.

      Fail-open is correct for a DOWNLOAD and wrong for an allowance shown back
      to the visitor. This assertion is what stops the convenient helper being
      reached for again.
    */
    /* Comments stripped: the module explains WHAT it replaced and why, and a
       bare `not.toMatch` finds `consumeDaily` in that explanation. Third time
       this trap has bitten in this file — the assertions are about code. */
    const code = policy.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/consumeDaily|peekDaily|alreadyCounted/);
    expect(code).toMatch(/from\("batch_sessions"\)/);
  });

  it("counts anonymous visitors per BROWSER, not per IP", () => {
    // A carrier NATs thousands onto one address; an IP-keyed allowance makes
    // strangers spend each other's. The ip hash is recorded, never counted.
    expect(policy).toMatch(/q\.eq\("anon_id", anonId!\)/);
    expect(policy).toMatch(/Recorded for a future abuse control, never the counting key/);
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
  /* Comments stripped — the file DOCUMENTS the class it moved away from, and a
     bare `not.toMatch` would fail on the very explanation of why it is gone.
     Same reason as the button block above. */
  const introCode = intro.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("starts hidden", () => {
    expect(intro).toMatch(/const \[showDetail, setShowDetail\] = useState\(false\)/);
  });

  it("auto-hides after exactly 3 seconds", () => {
    expect(intro).toMatch(/setTimeout\(\(\) => setShowDetail\(false\), 3000\)/);
  });

  it("is opened by a ? beside the heading, not a Learn more link", () => {
    // Owner: "no need for the learn me there, you just put a question mark at
    // the top of the multi link H1 text".
    expect(introCode).toMatch(/<HelpCircle/);
    expect(introCode).not.toMatch(/Learn more/);
  });

  it("does NOT draw the daily allowance in the collapsed card", () => {
    // Owner: "put the batch remaining to show after the plus multi link button
    // is clicked" — it lives in the opened panel now.
    expect(introCode).not.toMatch(/remaining today/i);
    expect(read("features/downloader/multi-link/multi-link-button.tsx")).not.toMatch(
      /remainingToday/,
    );
  });

  it("carries the Up to N pill from the reference", () => {
    expect(introCode).toMatch(/Up to \{sourceLimit\}/);
  });

  it("🔴 no longer renders the three capability chips", () => {
    /*
      Owner, 2026-08-25, with a screenshot of the row: "remove this section from
      the multi link card". They came from the reference and were kept for a
      day; every one of them restated the sentence that is already behind the
      "?", so at rest they cost three rows of the hero and taught nothing the
      control below does not already say.

      Asserted on the LABELS and on the icon imports both: dropping the markup
      but leaving `Link2`/`Shuffle`/`Package` imported is the shape a partial
      revert takes.
    */
    for (const chip of ["Same platform", "Mixed platforms", "Batch download"]) {
      expect(introCode).not.toContain(chip);
    }
    for (const icon of ["Link2", "Shuffle", "Package"]) {
      expect(introCode).not.toContain(icon);
    }
  });

  it("puts the paste box ABOVE the install prompt, where the prompt is shown", () => {
    /*
      The reference's order (paste box → Install → Multi-Link) is unchanged and
      still asserted — but the banner is now OPTIONAL.

      Owner, 2026-08-25: "i think the install CTA in the landing hero is causing
      visual noise". It moved into the top bar (`SiteHeader landing` renders
      `InstallHeaderCta`, which is what the wordmark text and the search trigger
      were removed to make room for), so the landing passes
      `installBanner={false}` and /downloads — whose header has no such room —
      keeps it.

      Asserted as a CONDITIONAL rather than deleted: the slot and its order are
      still the thing that must not regress, and a test that simply stopped
      looking would not notice the banner reappearing on both surfaces at once.
    */
    const core = read("features/downloads/download-page-core.tsx");
    expect(core).toMatch(/afterForm=\{installBanner \? <InstallHeroBanner \/> : null\}/);
    expect(core).toMatch(/installBanner = true/);
    // The landing is the surface that opts out; /downloads must not.
    expect(read("components/landing/hero.tsx")).toMatch(/installBanner=\{false\}/);
  });

  it("🔴 never shows TWO install calls to action on the landing at once", () => {
    /*
      The header group and the hero banner are mutually exclusive BY
      CONSTRUCTION, not by breakpoint arithmetic: the landing turns the banner
      off in the same file that turns the header arrangement on. Two gradient
      "Install" CTAs on one screen was the reported noise, and it is the kind of
      thing that comes back when one of the two halves is edited alone.
    */
    const page = read("app/(marketing)/page.tsx");
    expect(page).toMatch(/<SiteHeader landing \/>/);
    expect(read("components/landing/hero.tsx")).toMatch(/installBanner=\{false\}/);
  });

  it("🔴 never centres with a transform while an animation owns transform", () => {
    /*
      Owner reported the popup hanging off the right edge of the screen.

      Cause: `left-1/2 -translate-x-1/2` and `animate-fade-up` both write the
      SAME `transform` property, and the animation wins for as long as it is
      applied — its keyframes end at `translateY(0)`, silently discarding the
      `translateX(-50%)`. The card was therefore positioned with its LEFT edge
      at the midpoint and ran off from there.

      Centre through the LAYOUT (`inset-x-0 mx-auto`) so the two never touch
      the same property. This assertion is what stops the transform version
      coming back the next time someone reaches for the familiar idiom.
    */
    expect(introCode).toMatch(/inset-x-0 top-full z-20 mx-auto/);
    expect(introCode).not.toMatch(/-translate-x-1\/2/);
  });

  it("floats above the layout so it occupies no space", () => {
    /*
      The requirement is literally "so it doesnt occupy space". A block that
      expands in place occupies space by definition and would push the paste
      box down — a layout shift on the page whose CLS was measured at 0.684
      once already.
    */
    expect(introCode).toMatch(/absolute inset-x-0 top-full/);
  });

  it("keeps the heading, without the trailing clause", () => {
    /*
      Owner, 2026-08-25: remove "the all in once place text". The heading ITSELF
      stays — the "?" is anchored beside it by the owner's earlier instruction
      ("you just put a question mark at the top of the multi link H1 text"), so
      deleting the H1 would orphan the affordance holding the description.
    */
    /*
      The three words are no longer one string: "multiple" is wrapped in its own
      gradient span (hero-H1 style, see the test below), so the literal
      "Save multiple links" does not appear in the source any more. The first
      word became "Save" on 2026-09-03 ("replace all the word download with save
      ... so google crawler doesnt flag it as a pure downloader"); it tracks the
      hero H1 it was built to mirror, which moved in the same change. Asserted
      as the words in ORDER instead — which is the thing that actually matters
      and survives the next styling change to any one of them.
    */
    expect(introCode).toMatch(/Save[\s\S]{0,600}?multiple[\s\S]{0,200}?links/);
    expect(introCode).not.toMatch(/all in one place/i);
  });

  it("sets the heading in the BRAND face, and adds no font of its own", () => {
    /*
      This setting went through two reversals, so the assertion records where it
      landed rather than how it got there:

        1. `font-brand` (Outfit, the wordmark face) — chosen to avoid a new
           webfont on a page with a 1.6s LCP budget.
        2. Owner: "dont use the frenzsave brand font, use a more premium stylish
           font that havent been used before" → Playfair Display was added.
        3. Owner: "is best to reuse the frenzsave brand font that is at the top
           of the download page" → back to `font-brand`, and Playfair REMOVED.

      The negative assertions are the valuable half. A third face left loaded
      but unused would be pure weight on every route, and it is exactly the kind
      of thing a revert leaves behind.
    */
    expect(introCode).toMatch(/font-brand/);
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/Playfair/);
    expect(layout).not.toMatch(/luxeDisplay|--font-luxe/);
    expect(read("app/globals.css")).not.toMatch(/\.font-luxe/);
    // Exactly two faces ship: the UI sans and the one display face.
    expect(layout).toMatch(/import \{ Inter, Outfit \} from "next\/font\/google"/);
  });

  it("🔴 colours ONE word, hero-H1 style — not the whole line", () => {
    /*
      Owner, 2026-08-25: "the multi link text shouldnt carry all colored, only
      the middle text should be colored, just the Save. Discover. Explore
      Hero H1 style."

      The hero gives the gradient to `Discover.` alone and sets the words either
      side in ink. That works BECAUSE it is one word — a gradient across a whole
      line has nothing to contrast against, so it stops reading as emphasis and
      becomes merely a coloured heading, which is what the previous version did.

      So: the `<h3>` itself must carry an INK colour (not `text-transparent`),
      and exactly one inner span carries the clip.
    */
    expect(introCode).toMatch(/id="multi-link-heading"[\s\S]{0,400}?text-slate-900/);
    // The heading element itself is not the clipped one any more.
    expect(introCode).not.toMatch(/id="multi-link-heading"[\s\S]{0,300}?bg-clip-text/);
    // Exactly one gradient span in the file, and it uses the hero's own stops
    // rather than a second near-identical ramp.
    expect(introCode.match(/bg-clip-text/g) ?? []).toHaveLength(1);
    expect(introCode).toMatch(/from-blue-600 via-violet-600 to-fuchsia-600/);
    expect(introCode).toMatch(/dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400/);
    // Same stops as the hero H1 it is imitating — one source of truth by eye.
    expect(read("features/downloads/downloads-sections.tsx")).toMatch(
      /from-blue-600 via-violet-600 to-fuchsia-600/,
    );
  });

  it("the timer doesn't run out while it is being read", () => {
    expect(intro).toMatch(/onMouseEnter=\{\(\) => \{[\s\S]{0,160}clearTimeout\(hideTimer\.current\)/);
  });
});
