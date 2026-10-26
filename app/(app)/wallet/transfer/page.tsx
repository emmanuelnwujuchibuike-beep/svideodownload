import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { WalletTransfer } from "@/features/wallet/wallet-transfer";
import { recentCoinRecipients } from "@/lib/coin/recipients";
import { resolveStoryGift } from "@/lib/coin/story-gift";
import { resolveTransferPreset } from "@/lib/coin/transfer-preset";
import { walletPageData } from "@/lib/coin/wallet-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Transfer · Wallet", robots: { index: false, follow: false } };

/**
 * /wallet/transfer — Frenz Coin transfer (Part 5). The member's own summary decides what the screen offers; the API
 * decides again. `?to=<member id>` (from a chat's "Send Frenz Coin") pre-chooses the recipient: their EXISTING wallet
 * number and public name are resolved on the server, read-only and under the number lookup's own rate limit
 * (lib/coin/transfer-preset.ts, Part 7) — and nothing is sent until the member reviews and confirms with their PIN.
 */
export default async function WalletTransferPage({ searchParams }: { searchParams: Promise<{ to?: string | string[]; story?: string | string[] }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/transfer");
  const [{ summary }, sp] = await Promise.all([walletPageData(user.id), searchParams]);
  if (!summary) return <WalletLoadError title="Transfer" />;
  const to = typeof sp.to === "string" ? sp.to : null;
  // `&story=` (a Story viewer's coin button, 2026-10-26): shown as "A gift for their story" only if it is the recipient's live story the sender can see
  const [preset, storyGift] = summary.enabled
    ? await Promise.all([resolveTransferPreset(user.id, to), to && typeof sp.story === "string" ? resolveStoryGift(user.id, to, sp.story) : Promise.resolve(null)])
    : [null, null];
  // recent recipients (2026-10-26): only when the form will show them — nobody pre-chosen and sending is open
  const recents = summary.transfers.canSend && !preset ? await recentCoinRecipients(user.id) : [];
  return <WalletTransfer summary={summary} preset={preset} storyGift={preset ? storyGift : null} recents={recents.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl }))} />;
}
