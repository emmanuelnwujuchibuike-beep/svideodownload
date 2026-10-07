import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

/**
 * Admin → Frenz AI → Rewards: the referral analytics and the withdrawal queue
 * (rewards brief §19). Read only when an admin opens the tab — no timer, no
 * polling. Paginated (PostgREST stops at 1,000 rows silently) and capped.
 */
const WINDOW_DAYS = 90;
const CAP = 20_000;

export interface RewardsAdminView {
  windowDays: number;
  capped: boolean;
  totals: {
    clicks: number;
    signupsFromLinks: number;
    referredAccounts: number;
    activeReferred30d: number;
    qualifyingEngagements: number;
    aiGenerationRewards: number;
    aiShareRewards: number;
    /** 2026-10-07 (brief §18): published AI Reels (all time) and completed AI videos in the window. Null on the pre-0189 path. */
    aiReels: number | null;
    aiVideoGenerations: number | null;
    usableIssued: number;
    withdrawableIssued: number;
    qualifiedMembers: number;
    restrictedMembers: number;
  };
  withdrawals: { pending: number; reviewing: number; approved: number; processing: number; completedCredits: number; completedUsdCents: number };
  recentReferrals: { at: string; referrer: string; referred: string | null; event: string; amount: number; creditClass: string; contentType: string | null }[];
  queue: { id: string; user: string; userId: string; credits: number; usdCents: number; status: string; method: string; details: Record<string, string>; createdAt: string }[];
}

/**
 * 0189: the totals are summed in SQL (`rewards_admin_totals`) and the two
 * lists are small bounded reads — the tab no longer ships up to 20,000 rows to
 * the server to add up. Open withdrawals are counted whatever their age (the
 * old window missed a request older than 90 days that was still pending).
 */
export async function loadRewardsAdmin(): Promise<RewardsAdminView> {
  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [totals, recent, open] = await Promise.all([
    db.rpc("rewards_admin_totals", { p_since: since }),
    db.from("reward_events").select("beneficiary_id, event_type, amount, credit_class, referred_user_id, created_at").eq("role", "referrer").order("created_at", { ascending: false }).limit(50),
    db.from("withdrawal_requests").select("id, user_id, credits, amount_usd_cents, status, payout_method, payout_details, created_at").in("status", [...OPEN]).order("created_at", { ascending: true }).limit(500),
  ]);
  if (totals.error || !totals.data) return loadRewardsAdminLegacy();
  const t = totals.data as Partial<Record<keyof RewardsAdminView["totals"], unknown>> & { withdrawals?: Partial<Record<keyof RewardsAdminView["withdrawals"], unknown>> };
  const ev = (recent.data ?? []) as { beneficiary_id: string; event_type: string; amount: number; credit_class: string; referred_user_id: string | null; created_at: string }[];
  const queue = (open.data ?? []) as { id: string; user_id: string; credits: number; amount_usd_cents: number; status: string; payout_method: string; payout_details: Record<string, string>; created_at: string }[];
  const referredIds = [...new Set(ev.map((e) => e.referred_user_id).filter((x): x is string => !!x))];
  const ids = [...new Set([...ev.flatMap((e) => [e.beneficiary_id, e.referred_user_id]), ...queue.map((w) => w.user_id)].filter((x): x is string => !!x))];
  const [attributions, profiles] = await Promise.all([
    referredIds.length ? db.from("referral_attributions").select("referred_user_id, content_type").in("referred_user_id", referredIds) : Promise.resolve({ data: [] }),
    ids.length ? db.from("profiles").select("id, handle, email").in("id", ids.slice(0, 200)) : Promise.resolve({ data: [] }),
  ]);
  const contentOf = new Map(((attributions.data ?? []) as { referred_user_id: string; content_type: string | null }[]).map((a) => [a.referred_user_id, a.content_type]));
  const names = new Map<string, string>();
  for (const p of (profiles.data ?? []) as { id: string; handle: string | null; email: string | null }[]) names.set(p.id, p.handle ? `@${p.handle}` : (p.email ?? p.id.slice(0, 8)));
  const name = (id: string | null) => (id ? (names.get(id) ?? id.slice(0, 8)) : null);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    windowDays: WINDOW_DAYS,
    capped: queue.length >= 500,
    totals: {
      clicks: n(t.clicks),
      signupsFromLinks: n(t.signupsFromLinks),
      referredAccounts: n(t.referredAccounts),
      activeReferred30d: n(t.activeReferred30d),
      qualifyingEngagements: n(t.qualifyingEngagements),
      aiGenerationRewards: n(t.aiGenerationRewards),
      aiShareRewards: n(t.aiShareRewards),
      aiReels: t.aiReels === undefined ? null : n(t.aiReels),
      aiVideoGenerations: t.aiVideoGenerations === undefined ? null : n(t.aiVideoGenerations),
      usableIssued: n(t.usableIssued),
      withdrawableIssued: n(t.withdrawableIssued),
      qualifiedMembers: n(t.qualifiedMembers),
      restrictedMembers: n(t.restrictedMembers),
    },
    withdrawals: {
      pending: n(t.withdrawals?.pending),
      reviewing: n(t.withdrawals?.reviewing),
      approved: n(t.withdrawals?.approved),
      processing: n(t.withdrawals?.processing),
      completedCredits: n(t.withdrawals?.completedCredits),
      completedUsdCents: n(t.withdrawals?.completedUsdCents),
    },
    recentReferrals: ev.map((e) => ({ at: e.created_at, referrer: name(e.beneficiary_id) ?? "?", referred: name(e.referred_user_id), event: e.event_type, amount: e.amount, creditClass: e.credit_class, contentType: e.referred_user_id ? (contentOf.get(e.referred_user_id) ?? null) : null })),
    queue: queue.map((w) => ({ id: w.id, user: name(w.user_id) ?? w.user_id.slice(0, 8), userId: w.user_id, credits: w.credits, usdCents: w.amount_usd_cents, status: w.status, method: w.payout_method, details: w.payout_details ?? {}, createdAt: w.created_at })),
  };
}

const OPEN = ["pending", "reviewing", "approved", "processing"] as const;

/** Before 0189 is live (no `rewards_admin_totals` yet): the original paginated, capped read. Remove once 0189 is verified on production. */
async function loadRewardsAdminLegacy(): Promise<RewardsAdminView> {
  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const month = Date.now() - 30 * 86_400_000;
  const [events, links, attributions, profiles, withdrawals] = await Promise.all([
    paginatedSelect<{ beneficiary_id: string; role: string; event_type: string; amount: number; credit_class: string; referred_user_id: string | null; created_at: string }>(
      (from, to) => db.from("reward_events").select("beneficiary_id, role, event_type, amount, credit_class, referred_user_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).range(from, to) as never,
      CAP,
    ),
    paginatedSelect<{ clicks: number; signups: number }>((from, to) => db.from("share_links").select("clicks, signups").range(from, to) as never, CAP),
    paginatedSelect<{ referred_user_id: string; referrer_id: string; content_type: string | null }>((from, to) => db.from("referral_attributions").select("referred_user_id, referrer_id, content_type").eq("status", "active").range(from, to) as never, CAP),
    paginatedSelect<{ qualified_at: string | null; restricted: boolean; qualifying_engagements: number }>((from, to) => db.from("reward_profiles").select("qualified_at, restricted, qualifying_engagements").range(from, to) as never, CAP),
    paginatedSelect<{ id: string; user_id: string; credits: number; amount_usd_cents: number; status: string; payout_method: string; payout_details: Record<string, string>; created_at: string }>(
      (from, to) => db.from("withdrawal_requests").select("id, user_id, credits, amount_usd_cents, status, payout_method, payout_details, created_at").gte("created_at", since).order("created_at", { ascending: true }).range(from, to) as never,
      CAP,
    ),
  ]);
  const ev = events.rows;
  const contentOf = new Map(attributions.rows.map((a) => [a.referred_user_id, a.content_type]));
  const open = withdrawals.rows.filter((w) => ["pending", "reviewing", "approved", "processing"].includes(w.status));
  const ids = [...new Set([...ev.slice(0, 50).flatMap((e) => [e.beneficiary_id, e.referred_user_id]), ...open.map((w) => w.user_id)].filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from("profiles").select("id, handle, email").in("id", ids.slice(0, 200));
    for (const p of (data ?? []) as { id: string; handle: string | null; email: string | null }[]) names.set(p.id, p.handle ? `@${p.handle}` : (p.email ?? p.id.slice(0, 8)));
  }
  const name = (id: string | null) => (id ? (names.get(id) ?? id.slice(0, 8)) : null);
  return {
    windowDays: WINDOW_DAYS,
    capped: events.capped || withdrawals.capped,
    totals: {
      clicks: links.rows.reduce((a, l) => a + l.clicks, 0),
      signupsFromLinks: links.rows.reduce((a, l) => a + l.signups, 0),
      referredAccounts: attributions.rows.length,
      activeReferred30d: new Set(ev.filter((e) => e.role === "referrer" && Date.parse(e.created_at) >= month && e.referred_user_id).map((e) => e.referred_user_id)).size,
      qualifyingEngagements: profiles.rows.reduce((a, p) => a + p.qualifying_engagements, 0),
      aiGenerationRewards: ev.filter((e) => e.event_type === "ai_video_completed" && e.role === "actor").length,
      aiShareRewards: ev.filter((e) => e.event_type === "ai_video_shared" && e.role === "actor").length,
      aiReels: null,
      aiVideoGenerations: null,
      usableIssued: ev.filter((e) => e.credit_class === "usable").reduce((a, e) => a + e.amount, 0),
      withdrawableIssued: ev.filter((e) => e.credit_class === "withdrawable").reduce((a, e) => a + e.amount, 0),
      qualifiedMembers: profiles.rows.filter((p) => !!p.qualified_at).length,
      restrictedMembers: profiles.rows.filter((p) => p.restricted).length,
    },
    withdrawals: {
      pending: withdrawals.rows.filter((w) => w.status === "pending").length,
      reviewing: withdrawals.rows.filter((w) => w.status === "reviewing").length,
      approved: withdrawals.rows.filter((w) => w.status === "approved").length,
      processing: withdrawals.rows.filter((w) => w.status === "processing").length,
      completedCredits: withdrawals.rows.filter((w) => w.status === "completed").reduce((a, w) => a + w.credits, 0),
      completedUsdCents: withdrawals.rows.filter((w) => w.status === "completed").reduce((a, w) => a + w.amount_usd_cents, 0),
    },
    recentReferrals: ev
      .filter((e) => e.role === "referrer")
      .slice(0, 50)
      .map((e) => ({ at: e.created_at, referrer: name(e.beneficiary_id) ?? "?", referred: name(e.referred_user_id), event: e.event_type, amount: e.amount, creditClass: e.credit_class, contentType: e.referred_user_id ? (contentOf.get(e.referred_user_id) ?? null) : null })),
    queue: open.map((w) => ({ id: w.id, user: name(w.user_id) ?? w.user_id.slice(0, 8), userId: w.user_id, credits: w.credits, usdCents: w.amount_usd_cents, status: w.status, method: w.payout_method, details: w.payout_details ?? {}, createdAt: w.created_at })),
  };
}

/** Restrict (or clear) a member: no rewards, no qualification, no withdrawals while restricted. */
export async function setRewardRestriction(userId: string, restricted: boolean, reason: string | null, adminId: string): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("reward_profiles")
    .upsert({ user_id: userId, restricted, restricted_reason: restricted ? (reason ?? "").slice(0, 300) : null, restricted_by: adminId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) console.error("[rewards/admin] restriction failed", { userId, message: error.message });
  return !error;
}
