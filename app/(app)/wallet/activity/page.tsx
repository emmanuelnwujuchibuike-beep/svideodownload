import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletActivity } from "@/features/wallet/wallet-activity";
import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { coinHistory } from "@/lib/coin/wallet";
import { walletPageData } from "@/lib/coin/wallet-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity · Wallet", robots: { index: false, follow: false } };

/** /wallet/activity — every Frenz Coin entry, newest first; more pages load on tap (Part 5). */
export default async function WalletActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/activity");
  const { summary, loadedAt } = await walletPageData(user.id);
  if (!summary) return <WalletLoadError title="Activity" />;
  if (!summary.enabled) return <WalletActivity history={null} disabled loadedAt={loadedAt} />;
  const h = await coinHistory(user.id, { limit: 20 });
  return <WalletActivity history={h.ok ? { items: h.items, next: h.next } : null} loadedAt={loadedAt} />;
}
