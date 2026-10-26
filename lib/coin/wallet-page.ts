import "server-only";

import { getLandingSettings } from "@/lib/landing/settings";

import { type CoinWalletSummary, coinWalletSummary } from "./wallet";

/**
 * The wallet pages' shared server read (Frenz Coin Part 5): the member's own summary — the same read as
 * GET /api/coin/wallet. Each page signs the member in itself (`if (!user) redirect("/login…")`, so the edge answers
 * guests: lib/auth/guest-login-paths.ts). Rendering it on the server means a wallet page opens with its numbers in ONE
 * request, and the router cache replays it on back-swipe with none.
 */
export async function walletPageData(userId: string): Promise<{ summary: CoinWalletSummary | null; loadedAt: number }> {
  const settings = await getLandingSettings();
  // Frenz Coin off: nothing is read beyond the switch (the page shows "not available")
  if (!settings.frenzCoin.enabled) return { summary: disabledSummary(), loadedAt: Date.now() };
  return { summary: await coinWalletSummary(userId, settings.frenzCoin), loadedAt: Date.now() };
}

/** What a page shows when Frenz Coin is switched off: no balances, nothing allowed. */
export function disabledSummary(): CoinWalletSummary {
  return {
    enabled: false,
    currency: "USD",
    centsPerCoin: 100,
    walletNumber: null,
    availableCents: 0,
    pendingCents: 0,
    heldCents: 0,
    totalCents: 0,
    pendingDeposits: [],
    nextReleaseAt: null,
    deposits: { enabled: false, holdHours: 1, minCents: 0, maxCents: 0 },
    transfers: { enabled: false, canSend: false, blockedBy: "disabled", pin: { set: false, lockedUntil: null }, minCents: 0, maxCents: 0, dailyMaxCents: 0, feeExamples: [], fee: { percentBp: 0, lowThresholdCents: 0, highThresholdCents: 0, flatBelowCents: 0, flatMidCents: 0, flatAboveCents: 0 } },
    withdrawals: { enabled: false, percentBp: 0, flatCents: 0, minCents: 0, maxCents: 0, payoutRateApproved: false, example: { grossCents: 0, feeCents: 0, netCents: 0 } },
  };
}
