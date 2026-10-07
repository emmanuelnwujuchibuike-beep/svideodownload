import { NextResponse } from "next/server";

import { WALLET_UNIT } from "@/lib/ai/credits/units";
import { publicWalletOffer } from "@/lib/ai/credits/wallet-config";

import { concurrencyLimitFor } from "@/lib/ai/character-replace/config";
import { deviceCookieHeader, freeEligibilityMessage, getCharacterReplaceFreeEligibility, newDeviceId, readDeviceId } from "@/lib/ai/character-replace/free-access";
import { countOpenJobs } from "@/lib/ai/character-replace/open-job";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getCharacterReplaceBalanceCents, listCharacterReplaceLedger } from "@/lib/ai/character-replace/wallet";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { primaryAiFeature } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { aiCurrencySymbol, getLandingSettings, isAiCurrency } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/character-replace/balance — the product wallet, and its statement.
 *
 * Part 3, §2: a dedicated balance the member can see is THEIRS for this tool.
 * Reads `ai_product_balances` / `ai_product_ledger` (0154) and never the AI
 * wallet. The recharge ladder and bounds ride along from the tool's config so
 * the sheet needs no second request.
 */
export async function GET(request: Request) {
  /*
    🔴 2026-10-04: this asked for `aiFeature("ai_character_replace")` and refused
    FEATURE_UNAVAILABLE when it answered null. Part 5 retired that registry row —
    so the moment Character Replace lost its engine, every member's balance page
    read "Couldn't load your balance right now". The wallet is shared by every
    paid tool and never belonged to Character Replace; only this gate said so.

    The feature is needed to resolve the subject and the member's own processing
    figures, nothing more, so it asks for the surface's anchor — exactly what
    `/api/ai/balance` has always done. A retired tool must never be able to take
    the wallet down again: `wallet-routes.test.ts` fails if this regresses.
  */
  const feature = primaryAiFeature();
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }
  const burst = await aiJobReadLimiter.limit(`ai-cr-balance:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }
  const ledgerParam = Number(new URL(request.url).searchParams.get("ledger") ?? "");
  const ledgerLimit = Number.isFinite(ledgerParam) && ledgerParam > 0 ? Math.min(100, Math.floor(ledgerParam)) : 10;
  try {
    const [settings, balanceCents, ledger] = await Promise.all([
      getLandingSettings(),
      getCharacterReplaceBalanceCents(subject.userId),
      listCharacterReplaceLedger(subject.userId, ledgerLimit),
    ]);
    const recharge = settings.frenzAiCharacterReplace.recharge;
    // the live rate (cached an hour) so the sheet previews exactly what checkout will charge
    const rate = await resolveCheckoutRate(settings.frenzAiCharacterReplace, settings.frenzAiCurrency);
    /*
      Part 11 §6, §16: the complimentary creations, from the one authoritative
      read — granted on first sight against the device cookie, answered from
      the row after that. The message is the member's; the reason is a word.
    */
    const headers = new Headers({ "cache-control": "no-store" });
    if (!readDeviceId(request)) headers.append("set-cookie", deviceCookieHeader(newDeviceId()));
    const free = await getCharacterReplaceFreeEligibility({ subject, config: settings.frenzAiCharacterReplace, request, plans: settings.frenzAiPlans });
    /*
      0166: the member's own processing figures, for the picker and the board
      — how many videos may run at once for THEM (their plan, an admin's
      figure, the operator's caps), how many may be open, how many are open
      now. Display only; the claim and the pump decide with the same function.
    */
    const adminUser = await getAdminUser().catch(() => null);
    const entitlement = await getAiEntitlement(subject, feature);
    const processing = settings.frenzAiCharacterReplace.processing;
    const concurrency = concurrencyLimitFor(settings.frenzAiCharacterReplace, { audience: entitlement.audience, isAdmin: !!adminUser, policyMaxConcurrent: entitlement.maxConcurrent });
    const openJobs = await countOpenJobs(subject, feature, { includeDrafts: false }).catch(() => 0);
    return NextResponse.json(
      {
        processing: {
          queueEnabled: processing.queueEnabled,
          concurrency,
          maxVideosPerBatch: processing.maxVideosPerBatch,
          openJobs,
          canAdd: processing.queueEnabled ? Math.max(0, processing.maxVideosPerBatch - openJobs) : Math.max(0, concurrency - openJobs),
        },
        freeAccess: {
          // a transient verdict (first read before the cookie, or a store fault) shows nothing rather than a refusal
          enabled: settings.frenzAiCharacterReplace.freeAccess.enabled && free.reason !== "TEMPORARILY_UNAVAILABLE",
          eligible: free.eligible,
          remaining: free.remainingFreeUses,
          granted: free.granted,
          used: free.used,
          reason: free.reason,
          requiresVerification: free.requiresVerification,
          message: freeEligibilityMessage(free),
          limits: free.limits,
        },
        product: "character_replace",
        balanceCents,
        currency: settings.frenzAiCurrency,
        symbol: aiCurrencySymbol(settings.frenzAiCurrency),
        unit: WALLET_UNIT,
        // 0184: credit packs priced in USD; the checkout converts (below)
        offer: publicWalletOffer(settings.frenzAiPlans.wallet, settings.frenzAiPlans.credits.centsPerCredit),
        /*
          2026-09-20: when the wallet is USD and Paystack collects naira, the
          sheet prints "≈ ₦7,500 at checkout" beside "$5.00" from this — the
          operator's rate, never a browser's. Null when no conversion applies.
        */
        checkout: rate && !("error" in rate)
          ? { currency: recharge.checkoutCurrency, symbol: isAiCurrency(recharge.checkoutCurrency) ? aiCurrencySymbol(recharge.checkoutCurrency) : recharge.checkoutCurrency, minorPerUsd: rate.minorPerUsd }
          : null,
        ledger,
      },
      { headers },
    );
  } catch (e) {
    console.error("[ai/cr/balance] read failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
