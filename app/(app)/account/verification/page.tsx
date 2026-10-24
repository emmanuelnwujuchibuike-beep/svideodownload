import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { PaidVerificationCard } from "@/features/account/paid-verification-card";
import { VerificationFlow } from "@/features/account/verification-flow";
import { paidVerificationOffer } from "@/lib/social/paid-verification";
import { getVerificationState } from "@/lib/social/verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification", robots: { index: false, follow: false } };

/**
 * Verification — apply for the blue tick.
 *
 * No eligibility rules (owner, 2026-10-24): any member can buy the tick (the paid card, when the admin has priced it)
 * or apply for a review — the form starts at Identity.
 */
export default async function VerificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [state, { data: profile }, offer] = await Promise.all([
    getVerificationState(user.id),
    admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    // 0268: the admin's paid-verification offer, and this member's paid tick
    paidVerificationOffer(user.id),
  ]);
  const paidTick = state.verified && state.request?.decisionReason === "Paid verification";
  // the card: offered when on and not verified (or verified BY a payment, to renew); a reviewed or admin tick shows none
  const showPaid = offer.config.enabled && (!state.verified || paidTick);

  return (
    <SettingsPage title="Verification" description="Prove who you are and get the blue tick." bare>
      {showPaid ? <PaidVerificationCard priceCents={offer.config.priceCents} periodDays={offer.config.periodDays} verified={paidTick} paidUntil={offer.lifetime ? null : offer.paidUntil} /> : null}
      <VerificationFlow
        state={state}
        displayName={(profile?.display_name as string | null) ?? user.email ?? "your account"}
      />
    </SettingsPage>
  );
}
