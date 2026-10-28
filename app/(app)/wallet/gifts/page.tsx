import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GiftBox } from "@/features/gift/gift-box";
import { walletPageData } from "@/lib/coin/wallet-page";
import { loadConversionRules } from "@/lib/gift/conversion";
import { giftWalletSummary } from "@/lib/gift/gifts-server";
import { giftHistory } from "@/lib/gift/history";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gift Box · Wallet", robots: { index: false, follow: false } };

const CHAT_PATH = /^\/messages\/[0-9a-f-]{36}$/i;

/**
 * /wallet/gifts — the Gift Box (Frenz Gift Coin Part 5, design/sticker-gifts.html screen 7): the member's Gift Coin
 * balance (due gift earnings released by this read), their received and sent gifts from each gift's stored snapshot,
 * and converting with the existing engine.
 *
 * Part 6 (screen 6, the top-up route): `?convert=fc_to_fgc` opens the converter on Frenz Coins → Gift Coins, and
 * `?back=/messages/<id>` (a chat path only — anything else is ignored) offers the way back to the chat after converting.
 * The member's Frenz Coin figures are read here so the converter shows what they really have: available FC, and
 * deposits still pending or held, shown as NOT yet available — never added to the balance before they settle.
 */
export default async function GiftBoxPage({ searchParams }: { searchParams: Promise<{ convert?: string; back?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/gifts");
  const sp = await searchParams;
  // the wallet read first: it releases due earnings, so the history below shows them as available
  const wallet = await giftWalletSummary(user.id);
  const [history, rules, coin] = await Promise.all([giftHistory(user.id, "received", { limit: 20 }), loadConversionRules(), walletPageData(user.id)]);
  const fc = coin.summary?.enabled ? { available: coin.summary.availableCents, pending: coin.summary.pendingCents + coin.summary.heldCents } : null;
  return (
    <GiftBox
      wallet={wallet}
      initial={history.ok ? { items: history.items, next: history.next } : null}
      counts={history.ok ? history.counts : { received: null, sent: null }}
      conversion={rules.ok ? rules.rules : null}
      fc={fc}
      initialDirection={sp.convert === "fc_to_fgc" ? "fc_to_fgc" : "fgc_to_fc"}
      back={typeof sp.back === "string" && CHAT_PATH.test(sp.back) ? sp.back : null}
    />
  );
}
