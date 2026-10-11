import "server-only";

import { trustSignals } from "@/lib/social/graph/trust-server";
import { createAdminClient } from "@/lib/supabase/admin";

import { relationshipReputation, type Reputation } from "./reputation";

/**
 * Relationship Reputation™, Transparency Center™ and Trust Intelligence™ reads
 * (Feature 19 · Part 16). Everything is computed on read from the decisions and
 * relationships Frenz already records — no score is stored, so there is nothing
 * to drift and nothing hidden. The member sees their own; admins see the abuse
 * signals, each with the reason it was raised.
 */

type Row = Record<string, unknown>;
const YEAR_MS = 365 * 86_400_000;

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const r = await q;
  return r.error ? 0 : (r.count ?? 0);
}

export async function reputationFor(userId: string): Promise<Reputation | null> {
  const base = await trustSignals(userId);
  if (!base) return null;
  const db = createAdminClient();
  const yearAgo = new Date(Date.now() - YEAR_MS).toISOString();
  const [prof, helpful, moderator, community, recognitions, mentees, postIds, userRecent, userOlder, overturned] = await Promise.all([
    db.from("profiles").select("profile_type").eq("id", userId).maybeSingle(),
    count(db.from("reports").select("id", { count: "exact", head: true }).eq("reporter_id", userId).eq("status", "actioned")),
    count(db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("member_id", userId).eq("role", "moderator").eq("status", "active")),
    count(db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("creator_id", userId).eq("status", "active")),
    count(db.from("creator_recognitions").select("kind", { count: "exact", head: true }).eq("member_id", userId)),
    count(db.from("pro_connections").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`and(requester_id.eq.${userId},requester_role.eq.mentor),and(addressee_id.eq.${userId},addressee_role.eq.mentor)`)),
    db.from("posts").select("id").eq("publisher_id", userId).order("created_at", { ascending: false }).limit(500),
    count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "user").eq("target_id", userId).eq("status", "actioned").gte("created_at", yearAgo)),
    count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "user").eq("target_id", userId).eq("status", "actioned").lt("created_at", yearAgo)),
    count(db.from("moderation_appeals").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "overturned")),
  ]);
  const ids = ((postIds.data ?? []) as Row[]).map((p) => p.id as string);
  const [postRecent, postOlder] = ids.length
    ? await Promise.all([
        count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "post").in("target_id", ids).eq("status", "actioned").gte("created_at", yearAgo)),
        count(db.from("reports").select("id", { count: "exact", head: true }).eq("target_type", "post").in("target_id", ids).eq("status", "actioned").lt("created_at", yearAgo)),
      ])
    : [0, 0];
  return relationshipReputation({
    verified: base.verified,
    accountAgeDays: base.accountAgeDays,
    activity90: base.activity90,
    friends: base.friends,
    collaborations: base.collaborations,
    recommendations: base.recommendations,
    endorsers: base.endorsers,
    helpfulReports: helpful,
    moderatorOf: moderator,
    communityMembers: community,
    recognitions,
    mentees,
    profileType: ((prof.data as Row | null)?.profile_type as string | null) ?? null,
    upheldRecent: userRecent + postRecent,
    upheldOlder: userOlder + postOlder,
    overturnedAppeals: overturned,
    restricted: base.restricted,
  });
}

// ─── Transparency Center ────────────────────────────────────────────────────

export interface TransparencyItem {
  id: string;
  title: string;
  why: string;
  policy: string;
  at: string | null;
  status: "in effect" | "resolved" | "under review" | "no longer counts";
  appealHref: string | null;
  improve: string | null;
}

/** Every decision that affects the member, explained: why, the rule, when, and how to appeal or improve. */
export async function transparencyFor(userId: string): Promise<TransparencyItem[]> {
  const db = createAdminClient();
  const yearAgo = Date.now() - YEAR_MS;
  const [prof, rp, posts, appeals] = await Promise.all([
    db.from("profiles").select("is_suspended, is_hidden, is_verified").eq("id", userId).maybeSingle(),
    db.from("reward_profiles").select("restricted, qualification_status").eq("user_id", userId).maybeSingle(),
    db.from("posts").select("id, title").eq("publisher_id", userId).order("created_at", { ascending: false }).limit(500),
    db.from("moderation_appeals").select("id, target_type, target_id, status, admin_note, created_at, resolved_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
  ]);
  const p = prof.data as Row | null;
  const out: TransparencyItem[] = [];
  if (p?.is_suspended) out.push({ id: "suspended", title: "Your account is suspended", why: "The team suspended this account after a review.", policy: "Community rules", at: null, status: "in effect", appealHref: "/account/appeals", improve: "Appeal if you think this was a mistake." });
  if (p?.is_hidden) out.push({ id: "hidden", title: "Your account is limited to existing friends", why: "The team limited who can find and contact this account.", policy: "Community rules — safety", at: null, status: "in effect", appealHref: "/account/appeals", improve: "Appeal, or keep participating within the rules." });
  const r = rp.data as Row | null;
  if (r?.restricted) out.push({ id: "rewards", title: "Reward withdrawals are paused on your account", why: "The team paused withdrawals during a review.", policy: "Rewards rules", at: null, status: "in effect", appealHref: "/support", improve: "Contact support for the review." });
  if (r?.qualification_status === "rejected") out.push({ id: "qualification", title: "Your withdrawal application wasn't approved", why: "The team reviewed it against the rewards qualification.", policy: "Rewards qualification", at: null, status: "resolved", appealHref: "/rewards", improve: "Meet the requirements and apply again." });
  const postRows = (posts.data ?? []) as Row[];
  const titles = new Map(postRows.map((x) => [x.id as string, (x.title as string | null) ?? "a post"]));
  const ids = postRows.map((x) => x.id as string);
  const [userReports, postReports] = await Promise.all([
    db.from("reports").select("id, reason, created_at").eq("target_type", "user").eq("target_id", userId).eq("status", "actioned").order("created_at", { ascending: false }).limit(20),
    ids.length ? db.from("reports").select("id, target_id, reason, created_at").eq("target_type", "post").in("target_id", ids).eq("status", "actioned").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ]);
  for (const rep of [...((userReports.data ?? []) as Row[]), ...((postReports.data ?? []) as Row[])]) {
    const old = Date.parse(rep.created_at as string) < yearAgo;
    const onPost = !!rep.target_id && titles.has(rep.target_id as string);
    out.push({
      id: `report-${rep.id as string}`,
      title: onPost ? `A report on “${titles.get(rep.target_id as string)}” was upheld` : "A report on your account was upheld",
      why: `A moderator reviewed it and agreed it broke the rules (${String(rep.reason).replace(/_/g, " ")}).`,
      policy: `Community rules: ${String(rep.reason).replace(/_/g, " ")}`,
      at: rep.created_at as string,
      status: old ? "no longer counts" : "in effect",
      appealHref: old ? null : "/account/appeals",
      improve: old ? "Twelve months of good standing repaired this." : "It stops counting against you after twelve months.",
    });
  }
  for (const a of (appeals.data ?? []) as Row[]) {
    out.push({
      id: `appeal-${a.id as string}`,
      title: a.status === "overturned" ? "Your appeal succeeded" : a.status === "upheld" ? "Your appeal was reviewed and the decision stands" : "Your appeal is being reviewed",
      why: (a.admin_note as string | null) ?? (a.status === "pending" ? "A moderator will look at it and tell you the outcome." : "The moderator's decision is final for this item."),
      policy: "Appeals",
      at: (a.resolved_at ?? a.created_at) as string,
      status: a.status === "pending" ? "under review" : "resolved",
      appealHref: null,
      improve: null,
    });
  }
  return out;
}

// ─── Trust Intelligence (admin) ─────────────────────────────────────────────

export interface TrustFlag {
  userId: string;
  handle: string | null;
  flags: { kind: string; why: string }[];
}

/** Accounts behaving like spam, automation or repeat abuse — each flag says what it saw. Signals for review, never automatic action. */
export async function trustIntelligence(): Promise<TrustFlag[]> {
  const db = createAdminClient();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [reqs, follows, reports] = await Promise.all([
    db.from("friend_requests").select("sender_id").gte("created_at", day).limit(10000),
    db.from("follows").select("follower_id").gte("created_at", day).limit(20000),
    db.from("reports").select("target_type, target_id").eq("status", "actioned").gte("created_at", month).limit(5000),
  ]);
  const tally = (rows: Row[], key: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[key] as string, (m.get(r[key] as string) ?? 0) + 1);
    return m;
  };
  const flags = new Map<string, { kind: string; why: string }[]>();
  const add = (id: string, kind: string, why: string) => flags.set(id, [...(flags.get(id) ?? []), { kind, why }]);
  for (const [id, n] of tally((reqs.data ?? []) as Row[], "sender_id")) if (n >= 30) add(id, "mass_requests", `${n} friend requests in 24 hours`);
  for (const [id, n] of tally((follows.data ?? []) as Row[], "follower_id")) if (n >= 150) add(id, "mass_follows", `${n} follows in 24 hours`);
  const rep = (reports.data ?? []) as Row[];
  const postTargets = [...new Set(rep.filter((r) => r.target_type === "post").map((r) => r.target_id as string))];
  const { data: postOwners } = postTargets.length ? await db.from("posts").select("id, publisher_id").in("id", postTargets.slice(0, 2000)) : { data: [] };
  const ownerOf = new Map(((postOwners ?? []) as Row[]).map((p) => [p.id as string, p.publisher_id as string]));
  const upheld = new Map<string, number>();
  for (const r of rep) {
    const who = r.target_type === "user" ? (r.target_id as string) : ownerOf.get(r.target_id as string);
    if (who) upheld.set(who, (upheld.get(who) ?? 0) + 1);
  }
  for (const [id, n] of upheld) if (n >= 3) add(id, "repeat_violations", `${n} upheld reports in 30 days`);
  const ids = [...flags.keys()].slice(0, 200);
  const { data: profs } = ids.length ? await db.from("profiles").select("id, handle, created_at").in("id", ids) : { data: [] };
  const prof = new Map(((profs ?? []) as Row[]).map((p) => [p.id as string, p]));
  for (const id of ids) {
    const created = prof.get(id)?.created_at as string | undefined;
    if (created && Date.now() - Date.parse(created) < 7 * 86_400_000) add(id, "new_account", "Account is under a week old");
  }
  return ids.map((id) => ({ userId: id, handle: (prof.get(id)?.handle as string | null) ?? null, flags: flags.get(id)! })).sort((a, b) => b.flags.length - a.flags.length);
}
