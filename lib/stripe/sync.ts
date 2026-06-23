import { trackEvent } from "@/lib/analytics/events";
import { planForPrice, type StripeSubscription } from "@/lib/stripe/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/** Maps a Stripe subscription onto our `subscriptions` row (service role). */
export async function syncSubscription(sub: StripeSubscription): Promise<void> {
  const userId = sub.metadata?.user_id;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = planForPrice(priceId);
  const active = sub.status === "active" || sub.status === "trialing";

  const supabase = createAdminClient();

  // Resolve the user: prefer subscription metadata, else match by customer id.
  let resolvedUser = userId ?? null;
  if (!resolvedUser) {
    const { data } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", sub.customer)
      .maybeSingle();
    resolvedUser = (data?.user_id as string) ?? null;
  }
  if (!resolvedUser) return;

  await supabase.from("subscriptions").upsert(
    {
      user_id: resolvedUser,
      plan: active ? plan : "free",
      status: sub.status,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // Keep the legacy profiles.role roughly in sync (pro/business → 'pro').
  await supabase
    .from("profiles")
    .update({ role: active && plan !== "free" ? "pro" : "user" })
    .eq("id", resolvedUser);

  trackEvent(active ? "subscribe" : "subscribe_cancel", {
    userId: resolvedUser,
    metadata: { plan, status: sub.status },
  });
}
