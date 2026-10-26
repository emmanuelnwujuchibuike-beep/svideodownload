import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WalletLoadError } from "@/features/wallet/wallet-load-error";
import { WalletSecurity } from "@/features/wallet/wallet-security";
import { coinPinStatus, pinPepper } from "@/lib/coin/pin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security · Wallet", robots: { index: false, follow: false } };

/** /wallet/security — the member's Frenz Coin transaction PIN (Part 5). The same read as GET /api/coin/pin: set / locked, never the hash. */
export default async function WalletSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/wallet/security");
  if (!pinPepper()) return <WalletSecurity pin={{ available: false, set: false, lockedUntil: null }} />;
  const s = await coinPinStatus(user.id);
  if (!s) return <WalletLoadError title="Security" />;
  return <WalletSecurity pin={{ available: true, ...s }} />;
}
