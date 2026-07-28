import { BarChart3, Code2, Crown, Gem } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { SettingsPage } from "@/features/account/settings-page";
import { ManageBillingButton } from "@/features/monetization/manage-billing-button";
import { getPlanLimits } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan", robots: { index: false, follow: false } };

export default async function PlanSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
  const isBusiness = plan === "business";

  const apiDailyLimit = (await getPlanLimits())[plan as BillingPlan].apiDailyLimit;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count: apiUsedToday } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("day", todayUtc);

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
    <SettingsPage title="Plan" description="Your subscription, billing and business tools.">
      <div className="p-6 sm:p-8">
        <div
          className={cn(
            "flex flex-wrap items-center gap-4 rounded-2xl border p-4",
            isPremium ? "border-amber-500/20 bg-amber-500/[0.04]" : "border-border/60 bg-secondary/30",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm",
              isPremium ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/25" : "bg-secondary text-muted-foreground",
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

        {isBusiness ? (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.05] to-transparent p-4">
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
              <Link href="/account/analytics" prefetch className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                <BarChart3 className="h-4 w-4" /> Creator analytics
              </Link>
              <Link href="/developers" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
                <Code2 className="h-4 w-4" /> API docs
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsPage>
  );
}

function BizStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3.5", accent ? "border-amber-500/30 bg-amber-500/[0.06]" : "border-border/60 bg-card")}>
      <p className="text-lg font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
