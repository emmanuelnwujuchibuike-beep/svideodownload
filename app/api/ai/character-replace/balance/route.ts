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
import { reconcileMemberTopupsWithin } from "@/lib/ai/wallet/reconcile-topups";
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
    /*
      2026-10-07 (owner: deposits missing from @chris's statement): the
      member's own pending top-ups are asked of Paystack alongside the read —
      a deposit paid or cancelled in a checkout they never came back from is
      settled and announced here (lib/ai/wallet/reconcile-topups.ts). In the
      same wave, so it costs nothing when nothing is pending; when something
      was credited the balance and statement are read again.
    */
    const [settings, firstBalance, firstLedger, reconciled] = await Promise.all([
      getLandingSettings(),
      getCharacterReplaceBalanceCents(subject.userId),
      listCharacterReplaceLedger(subject.userId, ledgerLimit),
      reconcileMemberTopupsWithin(subject.userId),
    ]);
    const [balanceCents, ledger] = reconciled.credited > 0
      ? await Promise.all([getCharacterReplaceBalanceCents(subject.userId), listCharacterReplaceLedger(subject.userId, ledgerLimit)])
      : [firstBalance, firstLedger];
    const recharge = settings.frenzAiCharacterReplace.recharge;
    const headers = new Headers({ "cache-control": "no-store" });
    if (!readDeviceId(request)) headers.append("set-cookie", deviceCookieHeader(newDeviceId()));
    /*
      ── 🔴 ONE WAVE, NOT FIVE (2026-10-07, owner: "buttons respond slow") ──
      Measured on production: this answered in 0.8–1.4 s on every call — five
      independent reads awaited one after another (the checkout rate, the
      complimentary creations, the admin check, the entitlement, the open
      jobs), each a round trip. None needs another's answer, so they leave
      together and the slowest one is the cost.

      · the live rate (cached an hour) so the sheet previews what checkout charges
      · Part 11 §6, §16: the complimentary creations, from the one authoritative
        read — granted on first sight against the device cookie
      · 0166: the member's own processing figures — how many videos may run at
        once for THEM, how many may be open, how many are. Display only.
    */
    const [rate, free, adminUser, entitlement, openJobs] = await Promise.all([
      resolveCheckoutRate(settings.frenzAiCharacterReplace, settings.frenzAiCurrency),
      getCharacterReplaceFreeEligibility({ subject, config: settings.frenzAiCharacterReplace, request, plans: settings.frenzAiPlans }),
      getAdminUser().catch(() => null),
      getAiEntitlement(subject, feature),
      countOpenJobs(subject, feature, { includeDrafts: false }).catch(() => 0),
    ]);
    const processing = settings.frenzAiCharacterReplace.processing;
    const concurrency = concurrencyLimitFor(settings.frenzAiCharacterReplace, { audience: entitlement.audience, isAdmin: !!adminUser, policyMaxConcurrent: entitlement.maxConcurrent });
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
