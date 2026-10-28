import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PaidVerificationCard } from "@/features/account/paid-verification-card";
import { VerificationFlow } from "@/features/account/verification-flow";
import { paidVerificationOffer } from "@/lib/social/paid-verification";
import { getVerificationState } from "@/lib/social/verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification", robots: { index: false, follow: false } };

/**
 * Verification — design/frenz-verification.html (owner, 2026-10-28), without the ID document step.
 *
 * No eligibility rules (owner, 2026-10-24): any member may apply. When the admin has priced the tick, payment is the
 * last step and the application goes to review once it is confirmed; otherwise it goes to review straight away.
 * The return from checkout (`?paid=<reference>`) is settled by the existing PaidVerificationCard, which asks the
 * server — never this URL — whether the payment landed.
 */
export default async function VerificationSettingsPage({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [state, { data: profile }, offer, { paid }] = await Promise.all([
    getVerificationState(user.id),
    admin.from("profiles").select("display_name, handle, avatar_url").eq("id", user.id).maybeSingle(),
    paidVerificationOffer(user.id),
    searchParams,
  ]);
  const paidTick = state.verified && state.request?.decisionReason === "Paid verification";

  return (
    <VerificationFlow
      state={state}
      displayName={(profile?.display_name as string | null) ?? user.email ?? "your account"}
      handle={(profile?.handle as string | null) ?? null}
      avatarUrl={(profile?.avatar_url as string | null) ?? null}
      offer={{ enabled: offer.config.enabled, priceCents: offer.config.priceCents, periodDays: offer.config.periodDays }}
      paidUntil={paidTick && !offer.lifetime ? offer.paidUntil : null}
      paidReturn={
        paid && offer.config.enabled ? (
          <PaidVerificationCard priceCents={offer.config.priceCents} periodDays={offer.config.periodDays} verified={paidTick} paidUntil={offer.lifetime ? null : offer.paidUntil} />
        ) : null
      }
    />
  );
}
