import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin → Rewards → Affiliates (owner, 2026-10-30: "they only contact support to join the affiliate AI earnings where
 * they earn 10% or any amount set by admin … users who apply and get approval"). The 0255 affiliate_accounts table had
 * no screen; this is it: find a member by @handle, approve them at a rate, change the rate, or revoke.
 *
 * Approving also marks the member's reward profile approved: the database's own withdrawal function (0278
 * request_credit_withdrawal) refuses a profile that isn't, and it makes their rewards from then on withdrawable —
 * "all AI earning on quest should be used for AI generation unless they are approved for affiliate". The app's gate is
 * the affiliate status itself (lib/rewards/affiliate-status.ts), so a revoked affiliate cannot cash out whatever their
 * profile says.
 */
export interface AffiliateRow {
  userId: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  rateBp: number;
  reviewedAt: string | null;
  note: string | null;
  /** commissions paid so far, in credits */
  earnedCredits: number;
}

export async function listAffiliates(limit = 200): Promise<AffiliateRow[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("affiliate_accounts").select("user_id, status, rate_bp, reviewed_at, note, updated_at").order("updated_at", { ascending: false }).limit(limit);
  if (error || !data?.length) return [];
  const rows = data as { user_id: string; status: string; rate_bp: number; reviewed_at: string | null; note: string | null }[];
  const ids = rows.map((r) => r.user_id);
  const [profiles, commissions] = await Promise.all([
    db.from("profiles").select("id, handle, display_name").in("id", ids),
    db.from("affiliate_commissions").select("affiliate_id, credits").in("affiliate_id", ids).eq("status", "granted").limit(5000),
  ]);
  const who = new Map(((profiles.data ?? []) as { id: string; handle: string | null; display_name: string | null }[]).map((p) => [p.id, p]));
  const earned = new Map<string, number>();
  for (const c of (commissions.data ?? []) as { affiliate_id: string; credits: number | null }[]) earned.set(c.affiliate_id, (earned.get(c.affiliate_id) ?? 0) + Number(c.credits ?? 0));
  return rows.map((r) => ({
    userId: r.user_id,
    handle: who.get(r.user_id)?.handle ?? null,
    displayName: who.get(r.user_id)?.display_name ?? null,
    status: r.status,
    rateBp: r.rate_bp,
    reviewedAt: r.reviewed_at,
    note: r.note,
    earnedCredits: earned.get(r.user_id) ?? 0,
  }));
}

export type AffiliateDecision = "approved" | "revoked";

export async function setAffiliate(input: { handle?: string; userId?: string; status: AffiliateDecision; rateBp: number; adminId: string; note: string | null }): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  if (!Number.isInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > 5000) return { ok: false, status: 400, error: "The rate must be between 0% and 50%." };
  const db = createAdminClient();
  let userId = input.userId ?? null;
  if (!userId) {
    const handle = (input.handle ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!handle) return { ok: false, status: 400, error: "Enter the member's @handle." };
    const { data } = await db.from("profiles").select("id").ilike("handle", handle).maybeSingle();
    userId = (data?.id as string | undefined) ?? null;
    if (!userId) return { ok: false, status: 404, error: `No member is @${handle}.` };
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from("affiliate_accounts")
    .upsert({ user_id: userId, status: input.status, rate_bp: input.rateBp, reviewed_by: input.adminId, reviewed_at: now, note: input.note, updated_at: now }, { onConflict: "user_id" });
  if (error) return { ok: false, status: 503, error: "Couldn't save that. Try again in a moment." };
  if (input.status === "approved") {
    // the database's withdrawal check (0278) and the reward engine read the reward profile — approve it too
    const patch = { qualification_status: "approved", qualification_reviewed_at: now, qualification_reviewed_by: input.adminId, updated_at: now };
    const { data: had } = await db.from("reward_profiles").select("user_id, qualified_at").eq("user_id", userId).maybeSingle();
    if (had) await db.from("reward_profiles").update({ ...patch, qualified_at: (had.qualified_at as string | null) ?? now }).eq("user_id", userId);
    else await db.from("reward_profiles").insert({ user_id: userId, ...patch, qualified_at: now });
  }
  return { ok: true, userId };
}
