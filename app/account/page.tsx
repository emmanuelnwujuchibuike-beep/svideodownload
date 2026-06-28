import { CalendarDays, Code2, Crown, Gem, LogOut, Mail, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ApiKeys } from "@/features/api/api-keys";
import { ManageBillingButton } from "@/features/monetization/manage-billing-button";
import { isAdmin } from "@/lib/admin";
import { getPlanLimits } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function AccountPage() {
  if (!hasSupabase) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, avatar_url, created_at")
    .eq("id", user.id)
    .single();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end, cancel_at_period_end, subscription_ref")
    .eq("user_id", user.id)
    .maybeSingle();

  const planActive = sub?.status === "active" || sub?.status === "trialing";
  const plan = (planActive ? sub?.plan : "free") ?? "free";
  const planLabel = plan === "business" ? "Business" : plan === "pro" ? "Pro" : "Free";
  const canManage = !!sub?.subscription_ref;
  const isPremium = plan !== "free";

  const email = user.email ?? "—";
  const avatar =
    (user.user_metadata?.avatar_url as string | undefined) ||
    profile?.avatar_url ||
    null;
  const admin = isAdmin(profile?.role, user.email);
  const created = profile?.created_at ?? user.created_at;
  const initial = email.charAt(0).toUpperCase();

  // Effective API cap for this plan + today's usage (RLS lets a user read their
  // own api_usage rows) so they can monitor their daily API consumption.
  const apiDailyLimit = (await getPlanLimits())[plan as BillingPlan].apiDailyLimit;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count: apiUsedToday } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("day", todayUtc);

  // Business-only: 7-day API usage for the enhanced analytics card.
  const isBusiness = plan === "business";
  let apiUsed7d = 0;
  if (isBusiness) {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count } = await supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", weekAgo);
    apiUsed7d = count ?? 0;
  }

  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden pb-28 pt-32 sm:pt-44">

        <div className="container max-w-2xl">
          <header className="mb-10">
            <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Your account
            </h1>
            <p className="mt-2 text-muted-foreground">
              Manage your profile, plan, and API access.
            </p>
          </header>

          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
            {/* Profile header */}
            <div className="flex items-center gap-5 border-b border-border/60 p-6 sm:p-8">
              <div className="relative shrink-0">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-border"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 text-2xl font-bold text-white shadow-md shadow-blue-500/25">
                    {initial}
                  </div>
                )}
                {/* Diamond Crown overlay for premium/business */}
                <DiamondCrownBadge
                  plan={plan as BillingPlan}
                  size="md"
                  className="absolute -bottom-1 -right-1 ring-2 ring-card"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-lg font-semibold">{email}</p>
                  <DiamondCrownBadge plan={plan as BillingPlan} size="sm" />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {admin ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                      isPremium
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {isPremium ? <Crown className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    {planLabel}
                  </span>
                </div>
              </div>
            </div>

            {/* Plan / billing */}
            <div className="border-b border-border/60 p-6 sm:p-8">
              <div
                className={cn(
                  "flex flex-wrap items-center gap-4 rounded-2xl border p-4",
                  isPremium
                    ? "border-amber-500/20 bg-amber-500/[0.04]"
                    : "border-border/60 bg-secondary/30",
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm",
                    isPremium
                      ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/25"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  <Crown className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{planLabel} plan</p>
                  <p className="text-xs text-muted-foreground">
                    {plan === "free"
                      ? "Upgrade for an ad-free, faster experience."
                      : sub?.cancel_at_period_end
                        ? `Cancels on ${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "period end"}`
                        : sub?.current_period_end
                          ? `Renews ${new Date(sub.current_period_end).toLocaleDateString()}`
                          : "Active"}
                  </p>
                </div>
                {plan === "free" ? (
                  <Link
                    href="/pricing"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-500/25 transition hover:shadow-amber-500/40"
                  >
                    <Crown className="h-4 w-4" /> Upgrade
                  </Link>
                ) : canManage ? (
                  <ManageBillingButton className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-secondary disabled:opacity-60" />
                ) : null}
              </div>
            </div>

            {/* Business tools & analytics — enhanced tier */}
            {isBusiness ? (
              <div className="border-b border-border/60 bg-gradient-to-br from-amber-500/[0.05] to-transparent p-6 sm:p-8">
                <div className="mb-4 flex items-center gap-2">
                  <Gem className="h-5 w-5 text-amber-500" />
                  <h2 className="text-sm font-semibold">Business tools &amp; analytics</h2>
                  <DiamondCrownBadge plan="business" size="sm" showLabel className="ml-auto" />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <BizStat label="API calls today" value={(apiUsedToday ?? 0).toLocaleString()} />
                  <BizStat label="API calls (7d)" value={apiUsed7d.toLocaleString()} />
                  <BizStat label="Daily limit" value={apiDailyLimit.toLocaleString()} />
                  <BizStat label="Plan" value="Business" accent />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/developers"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
                  >
                    <Code2 className="h-4 w-4" /> API documentation
                  </Link>
                  <Link
                    href="/pricing#business"
                    className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
                  >
                    Manage plan
                  </Link>
                </div>
              </div>
            ) : null}

            {/* API keys */}
            <div className="border-b border-border/60 p-6 sm:p-8">
              <ApiKeys dailyLimit={apiDailyLimit} usedToday={apiUsedToday ?? 0} />
            </div>

            {/* Detail fields */}
            <dl className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
              <Detail icon={Mail} label="Email" value={email} />
              <Detail
                icon={CalendarDays}
                label="Member since"
                value={created ? new Date(created).toLocaleDateString() : "—"}
              />
            </dl>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 p-6 sm:p-8">
              <Link
                href="/#download"
                className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:shadow-primary/35 hover:opacity-95"
              >
                Download a video
              </Link>
              {admin ? (
                <Link
                  href="/admin"
                  className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary"
                >
                  Admin dashboard
                </Link>
              ) : null}
              <form action="/auth/signout" method="post" className="ml-auto">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl border border-border/70 px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-red-500/40 hover:text-red-400"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function BizStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5",
        accent ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-border/60 bg-card",
      )}
    >
      <p className="text-lg font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-semibold">{value}</dd>
      </div>
    </div>
  );
}
