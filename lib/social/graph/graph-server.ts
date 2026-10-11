import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { describeGraphQuery, matchesGraphQuery, parseGraphQuery, type GraphPerson, type GraphRelation } from "./search";

/**
 * Unified Social Graph™ reads (Feature 19 · Part 15): graph search over the
 * viewer's own network, private growth analytics, and the private graph history.
 *
 * The network is read from the real edge tables in one parallel batch, bounded
 * (2,000 people per relation), then profiles are read once for the union. Only
 * public profile facts are searched; nothing private about anyone is read.
 */

type Row = Record<string, unknown>;
const CAP = 2000;

export interface NetworkPerson {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  relations: GraphRelation[];
  roles: string[];
}

async function network(viewerId: string): Promise<{ people: Map<string, GraphPerson & { name: string; handle: string; avatarUrl: string | null }>; mySchools: string[] }> {
  const db = createAdminClient();
  const [fr, following, followers, pro, collab, community, subs, trusted, mine] = await Promise.all([
    db.from("friendships").select("user_low, user_high").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).limit(CAP),
    db.from("follows").select("following_id").eq("follower_id", viewerId).limit(CAP),
    db.from("follows").select("follower_id").eq("following_id", viewerId).limit(CAP),
    db.from("pro_connections").select("requester_id, addressee_id, requester_role, addressee_role").eq("status", "accepted").or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`).limit(CAP),
    db.from("post_collaborators").select("user_id, invited_by").eq("status", "accepted").or(`user_id.eq.${viewerId},invited_by.eq.${viewerId}`).limit(CAP),
    db.from("creator_memberships").select("creator_id, member_id, billing, status").eq("status", "active").or(`creator_id.eq.${viewerId},member_id.eq.${viewerId}`).limit(CAP),
    db.from("creator_memberships").select("member_id").eq("creator_id", viewerId).eq("billing", "sub").eq("status", "active").gt("period_end", new Date().toISOString()).limit(CAP),
    db.from("trusted_contacts").select("contact_id").eq("owner_id", viewerId).limit(50),
    db.from("profile_credentials").select("organization").eq("user_id", viewerId).eq("kind", "education").limit(20),
  ]);
  const rel = new Map<string, { relations: Set<GraphRelation>; roles: Set<string> }>();
  const add = (id: unknown, r: GraphRelation, role?: unknown) => {
    if (typeof id !== "string" || id === viewerId) return;
    const e = rel.get(id) ?? { relations: new Set<GraphRelation>(), roles: new Set<string>() };
    e.relations.add(r);
    if (typeof role === "string" && role) e.roles.add(role);
    rel.set(id, e);
  };
  for (const f of (fr.data ?? []) as Row[]) add(f.user_low === viewerId ? f.user_high : f.user_low, "friends");
  for (const f of (following.data ?? []) as Row[]) add(f.following_id, "following");
  for (const f of (followers.data ?? []) as Row[]) add(f.follower_id, "followers");
  for (const p of (pro.data ?? []) as Row[]) {
    if (p.requester_id === viewerId) add(p.addressee_id, "pro", p.addressee_role);
    else add(p.requester_id, "pro", p.requester_role);
  }
  for (const c of (collab.data ?? []) as Row[]) add(c.user_id === viewerId ? c.invited_by : c.user_id, "collaborators");
  for (const m of (community.data ?? []) as Row[]) add(m.creator_id === viewerId ? m.member_id : m.creator_id, "community");
  for (const s of (subs.data ?? []) as Row[]) add(s.member_id, "subscribers");
  for (const t of (trusted.data ?? []) as Row[]) add(t.contact_id, "trusted");
  // a block on either side removes the person from every answer
  const ids = [...rel.keys()];
  const [blocks, profs, details, creds] = ids.length
    ? await Promise.all([
        db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).limit(CAP),
        db.from("profiles").select("id, handle, display_name, avatar_url, profile_type, location, bio, is_suspended, is_hidden").in("id", ids.slice(0, 4 * CAP)),
        db.from("profile_details").select("user_id, skills, headline, category").in("user_id", ids.slice(0, 4 * CAP)),
        db.from("profile_credentials").select("user_id, organization").eq("kind", "education").in("user_id", ids.slice(0, 4 * CAP)).limit(8000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const blocked = new Set(((blocks.data ?? []) as Row[]).map((b) => (b.blocker_id === viewerId ? (b.blocked_id as string) : (b.blocker_id as string))));
  const det = new Map(((details.data ?? []) as Row[]).map((d) => [d.user_id as string, d]));
  const schools = new Map<string, string[]>();
  for (const c of (creds.data ?? []) as Row[]) if (c.organization) schools.set(c.user_id as string, [...(schools.get(c.user_id as string) ?? []), c.organization as string]);
  const people = new Map<string, GraphPerson & { name: string; handle: string; avatarUrl: string | null }>();
  for (const p of (profs.data ?? []) as Row[]) {
    const id = p.id as string;
    if (!p.handle || p.is_suspended || p.is_hidden || blocked.has(id)) continue;
    const d = det.get(id);
    const r = rel.get(id)!;
    people.set(id, {
      id,
      name: ((p.display_name as string) || `@${p.handle as string}`).slice(0, 60),
      handle: p.handle as string,
      avatarUrl: (p.avatar_url as string | null) ?? null,
      relations: [...r.relations],
      roles: [...r.roles],
      profileType: (p.profile_type as string | null) ?? null,
      location: (p.location as string | null) ?? null,
      bio: [p.bio, d?.headline, d?.category].filter(Boolean).join(" ") || null,
      skills: Array.isArray(d?.skills) ? (d!.skills as unknown[]).filter((s): s is string => typeof s === "string") : [],
      schools: schools.get(id) ?? [],
    });
  }
  return { people, mySchools: ((mine.data ?? []) as Row[]).map((c) => c.organization as string).filter(Boolean) };
}

export async function graphSearch(viewerId: string, q: string): Promise<{ understood: string; results: NetworkPerson[] }> {
  const parsed = parseGraphQuery(q.slice(0, 160));
  const { people, mySchools } = await network(viewerId);
  const results = [...people.values()]
    .filter((p) => matchesGraphQuery(p, parsed, mySchools))
    .slice(0, 60)
    .map((p) => ({ id: p.id, name: p.name, handle: p.handle, avatarUrl: p.avatarUrl, relations: p.relations, roles: p.roles }));
  return { understood: describeGraphQuery(parsed), results };
}

// ─── Private growth analytics ───────────────────────────────────────────────

export interface GraphGrowth {
  months: { month: string; friends: number; following: number; followers: number; pro: number }[];
  totals: { friends: number; following: number; followers: number; pro: number; community: number };
}

/** New connections per month for the last 12 months, by kind. Counts only, for the member's eyes. */
export async function graphGrowth(viewerId: string, now = new Date()): Promise<GraphGrowth> {
  const db = createAdminClient();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString();
  const head = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [fr, fo, fw, pro, frAll, foAll, fwAll, proAll, comm] = await Promise.all([
    db.from("friendships").select("created_at").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).gte("created_at", since).limit(5000),
    db.from("follows").select("created_at").eq("follower_id", viewerId).gte("created_at", since).limit(5000),
    db.from("follows").select("created_at").eq("following_id", viewerId).gte("created_at", since).limit(5000),
    db.from("pro_connections").select("responded_at").eq("status", "accepted").or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`).gte("responded_at", since).limit(5000),
    head(db.from("friendships").select("user_low", { count: "exact", head: true }).or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`)),
    head(db.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", viewerId)),
    head(db.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", viewerId)),
    head(db.from("pro_connections").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`)),
    head(db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("status", "active").or(`creator_id.eq.${viewerId},member_id.eq.${viewerId}`)),
  ]);
  const months: GraphGrowth["months"] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: d.toISOString().slice(0, 7), friends: 0, following: 0, followers: 0, pro: 0 });
  }
  const bump = (rows: unknown, key: "friends" | "following" | "followers" | "pro", col: string) => {
    for (const r of (rows ?? []) as Row[]) {
      const m = months.find((x) => x.month === String(r[col] ?? "").slice(0, 7));
      if (m) m[key]++;
    }
  };
  bump(fr.data, "friends", "created_at");
  bump(fo.data, "following", "created_at");
  bump(fw.data, "followers", "created_at");
  bump(pro.data, "pro", "responded_at");
  return { months, totals: { friends: frAll, following: foAll, followers: fwAll, pro: proAll, community: comm } };
}

// ─── Private history ────────────────────────────────────────────────────────

const HISTORY_DAYS = 730;
const KIND_TEXT: Record<string, string> = {
  friendship_started: "You became friends with",
  friendship_ended: "Your friendship ended with",
  followed: "You followed",
  unfollowed: "You unfollowed",
  blocked: "You blocked",
  unblocked: "You unblocked",
  pro_connected: "You confirmed working with",
  joined_community: "You joined the community of",
  subscribed: "You subscribed to",
  membership_ended: "Your membership ended with",
  member_joined: "A new member joined:",
  circle_added: "You added to a circle:",
  circle_removed: "You removed from a circle:",
  followed_you: "Started following you:",
  unfollowed_you: "Stopped following you:",
  privacy_changed: "You changed who can reach you:",
  boundary_on: "You turned on a Boundary Mode:",
  boundary_off: "Your Boundary Mode ended:",
  removed_from_memory: "Took themselves off your memory:",
};

export async function graphHistory(viewerId: string, before?: string | null): Promise<{ items: { id: number; text: string; person: { name: string; handle: string; avatarUrl: string | null } | null; at: string; detail: string | null }[]; next: string | null; ready: boolean }> {
  const db = createAdminClient();
  // kept two years, then forgotten — trimmed when looked at, no job runs for it
  await db.from("graph_history").delete().eq("user_id", viewerId).lt("created_at", new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString());
  let q = db.from("graph_history").select("id, other_id, kind, detail, created_at").eq("user_id", viewerId).order("created_at", { ascending: false }).limit(41);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) return { items: [], next: null, ready: !/schema cache|does not exist/i.test(error.message) };
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, 40);
  const ids = [...new Set(page.map((r) => r.other_id as string | null).filter((x): x is string => !!x))];
  const { data: profs } = ids.length ? await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", ids) : { data: [] };
  const who = new Map(((profs ?? []) as Row[]).map((p) => [p.id as string, { name: ((p.display_name as string) || `@${p.handle as string}`).slice(0, 60), handle: p.handle as string, avatarUrl: (p.avatar_url as string | null) ?? null }]));
  return {
    items: page.map((r) => ({ id: Number(r.id), text: KIND_TEXT[r.kind as string] ?? (r.kind as string), person: r.other_id ? (who.get(r.other_id as string) ?? null) : null, at: r.created_at as string, detail: (r.detail as string | null) ?? null })),
    next: rows.length > 40 ? (page[page.length - 1]!.created_at as string) : null,
    ready: true,
  };
}
