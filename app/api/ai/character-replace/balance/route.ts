import { NextResponse } from "next/server";

import { getCharacterReplaceBalanceCents, listCharacterReplaceLedger } from "@/lib/ai/character-replace/wallet";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { conversionApplies } from "@/lib/ai/character-replace/topup-fx";
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
  const feature = aiFeature("ai_character_replace");
  if (!feature) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  }
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
    return NextResponse.json(
      {
        product: "character_replace",
        balanceCents,
        currency: settings.frenzAiCurrency,
        symbol: aiCurrencySymbol(settings.frenzAiCurrency),
        topupOptionsCents: recharge.packages.filter((p) => p.enabled).map((p) => p.amountCents),
        minTopupCents: recharge.minCents,
        maxTopupCents: recharge.maxCents,
        /*
          2026-09-20: when the wallet is USD and Paystack collects naira, the
          sheet prints "≈ ₦7,500 at checkout" beside "$5.00" from this — the
          operator's rate, never a browser's. Null when no conversion applies.
        */
        checkout: conversionApplies(settings.frenzAiCurrency, recharge.checkoutCurrency) && settings.frenzAiCharacterReplace.localMinorUnitsPerUsd > 0
          ? { currency: recharge.checkoutCurrency, symbol: isAiCurrency(recharge.checkoutCurrency) ? aiCurrencySymbol(recharge.checkoutCurrency) : recharge.checkoutCurrency, minorPerUsd: settings.frenzAiCharacterReplace.localMinorUnitsPerUsd }
          : null,
        ledger,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    console.error("[ai/cr/balance] read failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
