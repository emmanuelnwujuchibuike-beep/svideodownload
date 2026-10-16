import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Part 3 (0242) — the delivery monitor's server side. Every read is one SQL
 * function over the delivery table and the daily counters (indexed, bounded,
 * paged); nothing reads raw ad events. Every action is one audited SQL call
 * that takes the admin's id — the route has already checked is_admin.
 */

type Db = SupabaseClient;

export const deliveryFiltersSchema = z
  .object({
    model: z.enum(["views_based", "fixed_period"]).optional(),
    status: z.enum(["paid", "validating", "active", "paused", "expired", "completed", "rejected", "removed"]).optional(),
    phase: z.enum(["initial", "extended", "review", "fulfilled", "shortfall"]).optional(),
    placement: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
    advertiser: z.string().trim().min(1).max(80).optional(),
    created_from: z.string().datetime().optional(),
    created_to: z.string().datetime().optional(),
    deadline_before: z.string().datetime().optional(),
    progress_below: z.number().min(0).max(1).optional(),
  })
  .strict();
export type DeliveryFilters = z.infer<typeof deliveryFiltersSchema>;

export const PAGE_SIZE = 20;

export async function deliveryOverview(db: Db, filters: DeliveryFilters, page: number) {
  const offset = Math.max(0, page) * PAGE_SIZE;
  // the advertiser search is a plain ilike in SQL: the wildcard characters a person might type are taken literally
  const f = { ...filters, ...(filters.advertiser ? { advertiser: filters.advertiser.replace(/[%_\\]/g, (m) => `\\${m}`) } : {}) };
  const [summary, list, capacity] = await Promise.all([
    db.rpc("ad_admin_delivery_summary", { p_from: null, p_to: null, p_soon_hours: 48 }),
    db.rpc("ad_admin_delivery_list", { p_filters: f, p_limit: PAGE_SIZE, p_offset: offset }),
    db.rpc("ad_admin_capacity"),
  ]);
  // before 0242 runs the functions are missing: the tab says so instead of failing
  const missing = [summary, list, capacity].find((r) => r.error)?.error;
  if (missing) return { migrated: false as const, reason: missing.code === "PGRST202" ? "needs_0242" : missing.message };
  return { migrated: true as const, summary: summary.data, list: list.data, capacity: capacity.data, pageSize: PAGE_SIZE };
}

export async function deliveryDetail(db: Db, campaignId: string) {
  const { data, error } = await db.rpc("ad_admin_delivery_detail", { p_campaign: campaignId });
  if (error) throw new Error(`delivery detail: ${error.message}`);
  return data;
}

export const deliveryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), campaignId: z.string().uuid(), days: z.number().int().min(1).max(90), reason: z.string().trim().min(5).max(300) }).strict(),
  z.object({ action: z.literal("close_refund"), campaignId: z.string().uuid(), reason: z.string().trim().min(5).max(300) }).strict(),
  z
    .object({
      action: z.literal("adjust"),
      campaignId: z.string().uuid(),
      delta: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0),
      reasonCode: z.enum(["invalid_traffic_removed", "verified_dispute_credit", "processing_error_correction"]),
      note: z.string().trim().min(5).max(500),
    })
    .strict(),
  // "retry safe background processing": the same idempotent deadline step the scheduler runs
  z.object({ action: z.literal("recheck"), campaignId: z.string().uuid() }).strict(),
]);
export type DeliveryAction = z.infer<typeof deliveryActionSchema>;

export async function runDeliveryAction(db: Db, adminId: string, a: DeliveryAction): Promise<Record<string, unknown>> {
  const call =
    a.action === "extend"
      ? db.rpc("ad_admin_resolve_delivery", { p_campaign: a.campaignId, p_admin: adminId, p_action: "extend", p_days: a.days, p_reason: a.reason })
      : a.action === "close_refund"
        ? db.rpc("ad_admin_resolve_delivery", { p_campaign: a.campaignId, p_admin: adminId, p_action: "close_refund", p_days: null, p_reason: a.reason })
        : a.action === "adjust"
          ? db.rpc("ad_admin_adjust_delivery", { p_campaign: a.campaignId, p_admin: adminId, p_delta: a.delta, p_reason_code: a.reasonCode, p_note: a.note })
          : db.rpc("ad_views_deadline", { p_campaign: a.campaignId });
  const { data, error } = await call;
  if (error) throw new Error(`delivery action: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Plain words for the database's refusals. */
export const DELIVERY_REFUSALS: Record<string, string> = {
  reason_required: "Write a reason (at least five characters) — it goes in the audit trail.",
  closed: "This delivery is already closed.",
  not_views: "This isn't a views campaign.",
  not_running: "The campaign isn't live or paused, so it can't be extended.",
  bad_days: "Extend by 1 to 90 days.",
  bad_reason: "Choose a reason for the correction.",
  delta_contradicts_reason: "That reason can't move the count in that direction.",
  out_of_range: "The count can't go below zero or past the target.",
  bad_delta: "Enter a change other than zero.",
};
