import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isWalletFundedFeature, WALLET_FUNDED_FEATURES } from "@/lib/ai/jobs";
import { KLING_RUNNABLE_FEATURES, klingPipeline } from "@/lib/ai/kling/pipelines/registry";
import { isTrustedProviderOutputUrl } from "@/lib/ai/character-replace/model";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴🔴 THE MONEY BUG — A VIDEO WAS CHARGED FOR AND NEVER REFUNDED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Production, 2026-10-04. The first two real Text to Video generations. Both
 * were charged, both failed, and NEITHER was ever given back:
 *
 *     ai_text_to_video  failed  funding=balance  charged=60
 *       error  FINALIZER_UNAVAILABLE
 *              worker declined: AI_FINALIZATION_FAILED — no source path recorded
 *       ai_product_ledger  processing_charge  reserved  -60   ← never released
 *     ai_text_to_video  failed  funding=balance  charged=36   ← identical, -36
 *
 * Two independent defects, each sufficient on its own, and NEITHER of them
 * intermittent — they were structural, so every generation would have hit both
 * for as long as the feature existed:
 *
 *  1 · `app/api/internal/ai/finalize/route.ts` routed only Character Replace
 *      and Lip Sync to the finalizer that KEEPS a provider's file. The two
 *      Kling video tools fell through to `finalizeAICleanJob` — the AI Clean
 *      MUX — whose fourth check demands `job.source_path`. Text to Video's
 *      input is a prompt (`mimeTypes: []`, `maxBytes: 0`). It has no source and
 *      never can. Image to Video is the same: NOTHING in `lib/ai/video/**` or
 *      `lib/ai/kling/**` writes `source_path` at all — its first frame is a URL
 *      Kling fetches. It had simply never been run on production.
 *
 *  2 · `lib/ai/video/create.ts` funds a video with `reserveAiWalletCharge`,
 *      which is a RESERVATION on `ai_product_ledger`. But the two features were
 *      missing from `WALLET_FUNDED_FEATURES`, so every undo fell through to the
 *      legacy branch, where `funding_source === "balance"` calls
 *      `refundAiCharge` → `refund_ai_charge`: a DIFFERENT ledger holding no row
 *      for the job. It found nothing and said nothing. All six undo paths — the
 *      /start catch, the webhook, the reconciler, the stall sweep, the
 *      finalizer and cancel — were silently useless for video.
 *
 * ── WHY THIS TEST IS SHAPED LIKE THIS ───────────────────────────────────────
 *
 * It does not name the two features. It walks `KLING_RUNNABLE_FEATURES` — the
 * registry that decides what can be generated at all — and asserts that each
 * one is registered everywhere its money and its output depend on. A third
 * video tool added without those registrations fails here rather than on a
 * member's balance, which is the only place the first two showed up.
 */

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("every runnable Kling video tool is registered where its MONEY is", () => {
  it.each([...KLING_RUNNABLE_FEATURES])("%s spends from the product wallet, so it must be wallet-funded", (id) => {
    const feature = klingPipeline(id).aiFeature;
    expect(isWalletFundedFeature(feature), `${feature} reserves on ai_product_ledger but releaseJobFunding would use refund_ai_charge`).toBe(true);
    expect(WALLET_FUNDED_FEATURES).toContain(feature);
  });

  /*
    Teeth. The predicate must still be able to answer NO — a version that
    returned true for everything would satisfy the case above and would ALSO
    hand a daily-allowance tool a product-wallet refund it never reserved.
  */
  it("still refuses a feature that is not wallet-funded", () => {
    expect(isWalletFundedFeature("ai_clean")).toBe(false);
    expect(isWalletFundedFeature("ai_not_a_real_feature")).toBe(false);
    expect(isWalletFundedFeature(null)).toBe(false);
  });
});

describe("every runnable Kling video tool reaches a finalizer that can finish it", () => {
  const route = src("app/api/internal/ai/finalize/route.ts");
  const service = src("server/services/ai-character-replace-finalize-service.ts");

  it.each([...KLING_RUNNABLE_FEATURES])("%s is routed to the keep-the-provider's-file finalizer, not the mux", (id) => {
    const feature = klingPipeline(id).aiFeature;
    /*
      The router picks `finalizeCharacterReplaceJob` for a closed list of
      feature ids. A Kling video missing from it goes to `finalizeAICleanJob`,
      which fails on `source_path` — after the charge.
    */
    const chooser = route.slice(route.indexOf("const finalize ="), route.indexOf("finalizeAICleanJob;") + 20);
    expect(chooser, `${feature} is not routed to finalizeCharacterReplaceJob`).toContain(`"${feature}"`);
    // and the service it is routed to must actually accept it
    expect(service, `${feature} is routed to the CR finalizer but that finalizer refuses it`).toContain(`"${feature}"`);
  });

  it("the mux finalizer still demands a source path for the tool that needs one", () => {
    /*
      Teeth, and the reason the fix is a ROUTE change rather than deleting the
      check: AI Clean genuinely cannot work without its original. Removing this
      guard to make video pass would have broken the one tool it protects.
    */
    expect(src("server/services/ai-finalize-service.ts")).toContain('detail: "no source path recorded"');
  });
});

describe("a video reservation is written in the wallet's own currency", () => {
  /*
    🔴 The third defect, and the one that made the first two unrecoverable.

    `reserve_product_charge` declares `p_currency text default 'NGN'`, and
    `lib/ai/character-replace/wallet.ts` passes `opts.snapshot.currency`
    straight through. A snapshot without a currency therefore does not fail —
    it silently books the charge in naira. Into a USD wallet, that charge can
    never be refunded, because `refund_product_charge` (0160) refuses a
    cross-currency credit rather than paying back ~1,335× the money.

    So the snapshot is asserted at the source: it must name the operator's
    configured wallet currency, not a literal and not nothing.
  */
  const create = src("lib/ai/video/create.ts");

  it("passes the configured wallet currency into the reservation", () => {
    expect(create).toContain("currency: settings.frenzAiCurrency");
    const reserve = create.slice(create.indexOf("const snapshot = {"), create.indexOf("reserveAiWalletCharge({ userId: ownerId") + 200);
    expect(reserve).toContain("currency: settings.frenzAiCurrency");
  });

  it("never books a video charge against a hardcoded currency", () => {
    // teeth: a literal here is the bug coming back under a different spelling
    expect(create).not.toMatch(/currency:\s*["']NGN["']/);
    expect(create).not.toMatch(/currency:\s*["']USD["']/);
  });

  it("the reserve RPC still defaults to NGN, which is why the snapshot must be explicit", () => {
    // If this default ever goes away the test above is still correct, but the
    // reason recorded here would be stale — so it is pinned to the migration.
    expect(src("supabase/migrations/0154_ai_product_wallet.sql")).toContain("p_currency text default 'NGN'");
  });
});

describe("a Kling output may actually be fetched", () => {
  /*
    The finalizer's second gate. Kling was missing from it, so the first Kling
    job to REACH a finalizer would have been refused as an untrusted host —
    again after the charge. Text to Video never got that far; it died one check
    earlier.
  */
  it("trusts Kling's delivery host", () => {
    // the host observed in the Part 4 contract, from a real generation
    expect(isTrustedProviderOutputUrl("https://v15-kling-fdl.klingai.com/a/b.mp4")).toBe(true);
    expect(isTrustedProviderOutputUrl("https://cdn.klingai.com/a.mp4")).toBe(true);
  });

  it("still refuses a look-alike, a plaintext URL and an aggregator", () => {
    expect(isTrustedProviderOutputUrl("https://klingai.com.attacker.test/a.mp4")).toBe(false);
    expect(isTrustedProviderOutputUrl("http://cdn.klingai.com/a.mp4")).toBe(false);
    expect(isTrustedProviderOutputUrl("https://evil.test/a.mp4")).toBe(false);
  });
});
