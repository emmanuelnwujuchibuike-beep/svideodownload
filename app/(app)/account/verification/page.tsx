import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { PaidVerificationCard } from "@/features/account/paid-verification-card";
import { VerificationFlow } from "@/features/account/verification-flow";
import { paidVerificationOffer } from "@/lib/social/paid-verification";
import { getVerificationState } from "@/lib/social/verification";
import { checkEligibility } from "@/lib/social/verification-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification", robots: { index: false, follow: false } };

/**
 * Verification — apply for the blue tick.
 *
 * Eligibility is computed HERE from real account data and handed to the form, so
 * the checklist a member reads is the same function `/api/verification` enforces
 * on submit. Nothing about the bar is hidden or hand-tuned per account.
 */
export default async function VerificationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [state, { data: profile }, { data: sub }, posts, offer] = await Promise.all([
    getVerificationState(user.id),
    admin
      .from("profiles")
      .select("handle, display_name, bio, avatar_url, followers_count, is_suspended, created_at")
      .eq("id", user.id)
      .maybeSingle(),
    admin.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle(),
    admin.from("posts").select("id", { head: true, count: "exact" }).eq("publisher_id", user.id).eq("status", "published"),
    // 0268: the admin's paid-verification offer, and this member's paid tick
    paidVerificationOffer(user.id),
  ]);
  const paidTick = state.verified && state.request?.decisionReason === "Paid verification";
  // the card: offered when on and not verified (or verified BY a payment, to renew); a reviewed or admin tick shows none
  const showPaid = offer.config.enabled && (!state.verified || paidTick);

  const paidPlan =
    (sub?.status === "active" || sub?.status === "trialing") && (sub?.plan as string | undefined) !== "free";

  const eligibility = checkEligibility({
    createdAt: (profile?.created_at as string) ?? user.created_at,
    handle: (profile?.handle as string | null) ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
    bio: (profile?.bio as string | null) ?? null,
    avatarUrl: (profile?.avatar_url as string | null) ?? null,
    followers: (profile?.followers_count as number | null) ?? 0,
    posts: posts.count ?? 0,
    emailConfirmed: !!user.email_confirmed_at,
    suspended: Boolean(profile?.is_suspended),
    paidPlan: Boolean(paidPlan),
  });

  return (
    <SettingsPage title="Verification" description="Prove who you are and get the blue tick." bare>
      {showPaid ? <PaidVerificationCard priceCents={offer.config.priceCents} periodDays={offer.config.periodDays} verified={paidTick} paidUntil={offer.lifetime ? null : offer.paidUntil} /> : null}
      <VerificationFlow
        state={state}
        eligibility={eligibility}
        displayName={(profile?.display_name as string | null) ?? user.email ?? "your account"}
      />
    </SettingsPage>
  );
}
