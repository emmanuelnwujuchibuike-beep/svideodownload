import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

/**
 * Publish an ADMIN'S OWN campaign as a test, without a payment (owner,
 * 2026-10-10: "make admin account can make ad without going through payment
 * for testing").
 *
 * It goes through the same door as a real payment and never pretends to be one:
 *   · only a campaign of the admin's OWN advertiser account — an admin cannot
 *     put someone else's unpaid campaign live for free
 *   · only one that was submitted (awaiting_payment / payment_processing)
 *   · the money record is written ONCE (ad_campaigns_guard keeps it immutable):
 *     amount 0 and the reference `admin-test:<admin id>` — so it can never be
 *     counted as revenue and is always recognisable as a test
 *   · an audit event says so, then the ordinary activation runs (creatives,
 *     placement, a free slot) — a test goes live exactly like a paid campaign
 */
export const ADMIN_TEST_REFERENCE_PREFIX = "admin-test:";

export async function adminTestPublish(db: Db, adminId: string, campaignId: string): Promise<{ ok: boolean; reason?: string; status?: string }> {
  const { data: c } = await db.from("ad_campaigns").select("id, status, advertiser_id, payment_verified_at, advertisers(user_id)").eq("id", campaignId).maybeSingle();
  const row = c as { id: string; status: string; payment_verified_at: string | null; advertisers: { user_id: string } | { user_id: string }[] | null } | null;
  if (!row) return { ok: false, reason: "not_found" };
  const owner = Array.isArray(row.advertisers) ? row.advertisers[0]?.user_id : row.advertisers?.user_id;
  if (owner !== adminId) return { ok: false, reason: "not_your_campaign" };
  if (row.payment_verified_at) return { ok: false, reason: "already_paid" };
  if (!["awaiting_payment", "payment_processing"].includes(row.status)) return { ok: false, reason: "not_submitted", status: row.status };

  const { data: updated, error } = await db
    .from("ad_campaigns")
    .update({ status: "paid", payment_verified_at: new Date().toISOString(), payment_reference: `${ADMIN_TEST_REFERENCE_PREFIX}${adminId}`, total_amount_minor: 0 })
    .eq("id", campaignId)
    .in("status", ["awaiting_payment", "payment_processing"])
    .is("payment_verified_at", null)
    .select("id");
  if (error || !updated?.length) return { ok: false, reason: "changed" };
  await db.from("ad_campaign_events").insert({ campaign_id: campaignId, kind: "paid", from_status: row.status, to_status: "paid", actor_id: adminId, actor_role: "admin", reason: "admin test - no charge" });

  const { activateCampaign } = await import("./server");
  const act = (await activateCampaign(db, campaignId, { id: adminId, role: "admin" }).catch(() => null)) as { ok?: boolean; reason?: string; status?: string } | null;
  return { ok: true, status: act?.ok ? "active" : (act?.status ?? "validating"), reason: act?.ok ? undefined : act?.reason };
}
