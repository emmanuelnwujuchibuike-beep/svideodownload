import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ApiKeys } from "@/features/api/api-keys";
import { SettingsPage } from "@/features/account/settings-page";
import { getPlanLimits } from "@/lib/monetization/plan";
import type { BillingPlan } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Developer", robots: { index: false, follow: false } };

export default async function DeveloperSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const planRow = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .maybeSingle();
  const active = planRow.data?.status === "active" || planRow.data?.status === "trialing";
  const plan = (active ? planRow.data?.plan : "free") ?? "free";

  const apiDailyLimit = (await getPlanLimits())[plan as BillingPlan].apiDailyLimit;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count: apiUsedToday } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("day", todayUtc);

  return (
    <SettingsPage title="Developer" description="API keys and daily usage.">
      <div className="p-6 sm:p-8">
        <ApiKeys dailyLimit={apiDailyLimit} usedToday={apiUsedToday ?? 0} />
      </div>
    </SettingsPage>
  );
}
