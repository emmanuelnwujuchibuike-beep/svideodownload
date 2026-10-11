import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { trustFromSignals, type TrustResult, type TrustSignals } from "./trust";

type Row = Record<string, unknown>;

/** The Trust Graph signals for one account, read in one parallel batch (counts only, no rows). */
export async function trustSignals(userId: string): Promise<TrustSignals | null> {
  const db = createAdminClient();
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const [prof, posts90, comments90, friends, collabs, recs, endorse, userReports, postIds, rp] = await Promise.all([
    db.from("profiles").select("is_verified, is_suspended, is_hidden, created_at").eq("id", userId).maybeSingle(),
    count(db.from("posts").select("id", { count: "exact", head: true }).eq("publisher_id", userId).gte("created_at", since90)),
    count(db.from("post_comments").select("id", { count: "exact", head: true }).eq("author_id", userId).gte("created_at", since90)),
    count(db.from("friendships").select("user_low", { count: "exact", head: true }).or(`user_low.eq.${userId},user_high.eq.${userId}`)),
    count(db.from("post_collaborators").select("post_id", { count: "exact", head: true }).eq("status", "accepted").or(`user_id.eq.${userId},invited_by.eq.${userId}`)),
    count(db.from("pro_recommendations").select("id", { count: "exact", head: true }).eq("subject_id", userId).eq("status", "accepted")),
    db.from("skill_endorsements").select("endorser_id").eq("subject_id", userId).limit(500),
    count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "user").eq("target_id", userId).eq("status", "actioned")),
    db.from("posts").select("id").eq("publisher_id", userId).order("created_at", { ascending: false }).limit(500),
    db.from("reward_profiles").select("restricted").eq("user_id", userId).maybeSingle(),
  ]);
  const p = prof.data as Row | null;
  if (!p) return null;
  const ids = ((postIds.data ?? []) as Row[]).map((r) => r.id as string);
  const postReports = ids.length ? await count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "post").in("target_id", ids).eq("status", "actioned")) : 0;
  return {
    verified: !!p.is_verified,
    accountAgeDays: Math.floor((Date.now() - Date.parse(p.created_at as string)) / 86_400_000),
    activity90: posts90 + comments90,
    friends,
    collaborations: collabs,
    recommendations: recs,
    endorsers: new Set(((endorse.data ?? []) as Row[]).map((e) => e.endorser_id as string)).size,
    upheldReports: userReports + postReports,
    restricted: !!p.is_suspended || !!p.is_hidden || !!(rp.data as Row | null)?.restricted,
  };
}

export async function trustFor(userId: string): Promise<(TrustResult & { signals: TrustSignals }) | null> {
  const s = await trustSignals(userId);
  return s ? { ...trustFromSignals(s), signals: s } : null;
}
