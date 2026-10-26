import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { WalletDeposit } from "@/features/wallet/wallet-deposit";
import { walletPageData } from "@/lib/coin/wallet-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Deposit · Wallet", robots: { index: false, follow: false } };

/** /wallet/deposit — Frenz Coin deposit (Part 5). The member's own summary decides what the screen offers; the API decides again. */
export default async function WalletDepositPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/deposit");
  const { summary } = await walletPageData(user.id);
  if (!summary) return <WalletLoadError title="Deposit" />;
  return <WalletDeposit summary={summary} />;
}
