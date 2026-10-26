import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { WalletWithdraw } from "@/features/wallet/wallet-withdraw";
import { memberCoinWithdrawals } from "@/lib/coin/withdrawals";
import { walletPageData } from "@/lib/coin/wallet-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Withdraw · Wallet", robots: { index: false, follow: false } };

/** /wallet/withdraw — Frenz Coin withdrawals (Part 5): the form when allowed, and the member's own requests either way. */
export default async function WalletWithdrawPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/withdraw");
  const { summary } = await walletPageData(user.id);
  if (!summary) return <WalletLoadError title="Withdraw" />;
  const withdrawals = summary.enabled ? await memberCoinWithdrawals(user.id) : [];
  return <WalletWithdraw summary={summary} withdrawals={withdrawals} />;
}
