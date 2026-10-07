import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The provider webhook log (migration 0186, `payment_provider_events`).
 *
 * `claimProviderEvent` is called after the signature is verified and before
 * any work: it inserts (provider, event id). A delivery already PROCESSED
 * answers "done" and the route acknowledges it without repeating anything; a
 * delivery seen but not processed (our earlier attempt failed) answers "retry"
 * and is processed again — every business operation behind it is idempotent
 * on its own reference, so a retry can complete a half-done delivery but never
 * double it. A log that cannot be written never blocks a payment: "new".
 */
export type ProviderEventClaim = "new" | "retry" | "done";

export async function claimProviderEvent(provider: "paystack" | "bachs", eventId: string | null | undefined, eventType: string, reference: string | null): Promise<ProviderEventClaim> {
  if (!eventId) return "new";
  const db = createAdminClient();
  const { error } = await db.from("payment_provider_events").insert({ provider, event_id: eventId.slice(0, 200), event_type: eventType.slice(0, 80), reference: reference?.slice(0, 200) ?? null });
  if (!error) return "new";
  if (error.code !== "23505") {
    console.error("[payments] event log write failed", { provider, eventId, message: error.message });
    return "new";
  }
  const { data } = await db.from("payment_provider_events").select("processed_at").eq("provider", provider).eq("event_id", eventId.slice(0, 200)).maybeSingle();
  return (data as { processed_at?: string | null } | null)?.processed_at ? "done" : "retry";
}

export async function markProviderEvent(provider: "paystack" | "bachs", eventId: string | null | undefined, outcome: string): Promise<void> {
  if (!eventId) return;
  const { error } = await createAdminClient().from("payment_provider_events").update({ processed_at: new Date().toISOString(), outcome: outcome.slice(0, 120) }).eq("provider", provider).eq("event_id", eventId.slice(0, 200));
  if (error) console.error("[payments] event log update failed", { provider, eventId, message: error.message });
}
