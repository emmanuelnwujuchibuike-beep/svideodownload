import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { WalletOverview } from "@/features/wallet/wallet-overview";
import { coinHistory } from "@/lib/coin/wallet";
import { walletPageData } from "@/lib/coin/wallet-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Wallet", robots: { index: false, follow: false } };

/**
 * /wallet — the Frenz Coin wallet (Part 5). Server-rendered with the member's own summary and first page of activity,
 * so it opens with its numbers in one request; the router cache replays it on back-swipe. `?deposit=<ref>` is the
 * Flutterwave return: the page only passes the reference on — the client asks the server to verify it.
 */
export default async function WalletPage({ searchParams }: { searchParams: Promise<{ deposit?: string | string[] }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet");
  const [{ summary, loadedAt }, sp] = await Promise.all([walletPageData(user.id), searchParams]);
  if (!summary) return <WalletLoadError title="Wallet" />;
  const history = summary.enabled ? await coinHistory(user.id, { limit: 20 }) : null;
  const ref = typeof sp.deposit === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(sp.deposit) ? sp.deposit : null;
  return <WalletOverview summary={summary} history={history && history.ok ? { items: history.items, next: history.next } : null} depositRef={summary.enabled ? ref : null} loadedAt={loadedAt} />;
}
