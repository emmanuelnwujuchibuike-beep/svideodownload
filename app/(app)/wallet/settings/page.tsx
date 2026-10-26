import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletSettings } from "@/features/wallet/wallet-settings";
import { coinPinStatus, pinPepper } from "@/lib/coin/pin";
import { recentCoinRecipients } from "@/lib/coin/recipients";
import { listSavedBanks } from "@/lib/coin/saved-banks";
import { getWalletPrefs } from "@/lib/coin/wallet-prefs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Wallet", robots: { index: false, follow: false } };

/**
 * /wallet/settings (2026-10-26) — the member's own wallet settings. Four reads in parallel, each failing to an empty
 * or default answer rather than an error page: the PIN state (set / locked, never the hash), the preferences, the saved
 * banks (last four digits only) and recent recipients (public names only).
 */
export default async function WalletSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/settings");
  const [pin, prefs, banks, recipients] = await Promise.all([
    pinPepper() ? coinPinStatus(user.id).catch(() => null) : Promise.resolve(null),
    getWalletPrefs(user.id),
    listSavedBanks(user.id),
    recentCoinRecipients(user.id),
  ]);
  return (
    <WalletSettings
      pin={pin ? { available: true, set: pin.set, lockedUntil: pin.lockedUntil } : { available: false, set: false, lockedUntil: null }}
      prefs={prefs}
      banks={banks}
      recipients={recipients.map((r) => ({ id: r.id, name: r.name, handle: r.handle }))}
    />
  );
}
