import { trackEvent } from "@/lib/analytics/events";
import { emit } from "@/lib/platform/event-bus";
import { createAdminClient } from "@/lib/supabase/admin";

import { planForPlanCode, type PaystackEventData } from "./paystack";

/**
 * Maps a Paystack webhook event onto our `subscriptions` row (service role).
 * Resolves the user via transaction metadata, then email, then existing refs.
 */
export async function syncPaystackEvent(
  eventType: string,
  data: PaystackEventData,
): Promise<void> {
  const supabase = createAdminClient();

  let userId: string | null = data.metadata?.user_id ?? null;

  const email = data.customer?.email ?? null;
  if (!userId && email) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    userId = (prof?.id as string) ?? null;
  }
  if (!userId && data.customer?.customer_code) {
    const { data: row } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("customer_ref", data.customer.customer_code)
      .maybeSingle();
    userId = (row?.user_id as string) ?? null;
  }
  if (!userId && data.subscription_code) {
    const { data: row } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("subscription_ref", data.subscription_code)
      .maybeSingle();
    userId = (row?.user_id as string) ?? null;
  }
  if (!userId) return;

  const plan = planForPlanCode(data.plan?.plan_code);
  let status: "active" | "canceled" | "past_due" = "active";
  let cancelAtEnd = false;
  let effectivePlan = plan;

  switch (eventType) {
    case "subscription.disable":
      status = "canceled";
      effectivePlan = "free";
      break;
    case "subscription.not_renew":
      cancelAtEnd = true; // stays active until period end
      break;
    case "invoice.payment_failed":
      status = "past_due";
      break;
    default: // charge.success | subscription.create | invoice.update
      status = "active";
  }

  // Don't downgrade on an active event whose payload didn't carry a plan code
  // (e.g. some charge.success events): keep the user's current plan instead.
  if (status !== "canceled" && effectivePlan === "free") {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.plan && existing.plan !== "free") {
      effectivePlan = existing.plan as typeof effectivePlan;
    }
  }

  const patch: Record<string, unknown> = {
    user_id: userId,
    plan: effectivePlan,
    status,
    provider: "paystack",
    cancel_at_period_end: cancelAtEnd,
    updated_at: new Date().toISOString(),
  };
  if (data.customer?.customer_code) patch.customer_ref = data.customer.customer_code;
  if (data.subscription_code) patch.subscription_ref = data.subscription_code;
  if (data.email_token) patch.email_token = data.email_token;
  if (data.next_payment_date) {
    patch.current_period_end = new Date(data.next_payment_date).toISOString();
  }

  await supabase.from("subscriptions").upsert(patch, { onConflict: "user_id" });

  await supabase
    .from("profiles")
    .update({ role: status !== "canceled" && effectivePlan !== "free" ? "pro" : "user" })
    .eq("id", userId);

  trackEvent(status === "canceled" ? "subscribe_cancel" : "subscribe", {
    userId,
    metadata: { plan: effectivePlan, status, provider: "paystack" },
  });

  // Domain event (in-process, fire-and-forget) for an activation.
  if (status !== "canceled" && effectivePlan !== "free") {
    emit("subscription.activated", { userId, plan: effectivePlan });
  }
}
