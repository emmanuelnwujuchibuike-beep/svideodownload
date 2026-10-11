import "server-only";

import { publishNotification } from "@/lib/notifications/publish";
import { resolveViewerRole } from "@/lib/profile/audience";
import { resolveProfileLayout } from "@/lib/profile/engine";
import type { ModuleKey } from "@/lib/profile/modules";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { friendshipState } from "@/lib/social/friends";
import { getPublicProfile } from "@/lib/social/profile";
import { viewerCircleIds } from "@/lib/social/graph/store";
import { CREDENTIAL_MODULE, type CredentialKind } from "@/lib/social/profile-platform-shared";
import { getProfileIdentity, getProfileModules, listCredentials } from "@/lib/social/profile-platform";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  careerTimeline,
  CONTEXT_MAX,
  CUSTOM_ROLE_MAX,
  isOpportunityKind,
  isProOpenTo,
  isProRole,
  isRecKind,
  MAX_OPEN_OPPORTUNITIES,
  networkSuggestions,
  NOTE_MAX,
  PENDING_REQUESTS_PER_DAY,
  rolePairAllowed,
  trustFactors,
  validateOpportunity,
  validateRecommendation,
  validateShortText,
  type AssistantSuggestion,
  type CareerItem,
  type OpportunityInput,
  type ProOpenTo,
  type ProRole,
  type RecKind,
  type TrustFactor,
} from "./engine";

/**
 * Professional Network™ — reads and writes (Feature 19 · Part 12).
 *
 * The owner of every write is the session user, passed in by the route. Every
 * write that names another person checks, here and not in the browser: they
 * exist and are visible, nobody has blocked anybody, and the rule for that
 * write (a confirmed connection or a friendship for recommendations and
 * endorsements, a listed skill for an endorsement, one open request per pair,
 * thirty new requests a day).
 *
 * Notifications are in-app only. A professional network that buzzes your
 * phone for every endorsement is the engagement machine the brief rules out.
 */

type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

export interface ProPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  headline: string | null;
}

export interface ProConnection {
  id: string;
  person: ProPerson;
  /** what THEY are to the viewer */
  theirRole: ProRole;
  /** what the viewer is to them */
  myRole: ProRole;
  customLabel: string | null;
  context: string | null;
  note: string | null;
  status: string;
  outgoing: boolean;
  createdAt: string;
  respondedAt: string | null;
}

export interface ProRecommendation {
  id: string;
  person: ProPerson;
  kind: RecKind;
  body: string;
  status: "pending" | "shown" | "hidden";
  createdAt: string;
}

export interface ProOpportunity {
  id: string;
  owner: ProPerson | null;
  kind: string;
  title: string;
  description: string | null;
  location: string | null;
  remote: boolean;
  link: string | null;
  status: string;
  createdAt: string;
}

export interface NetworkDashboard {
  me: ProPerson & { openTo: ProOpenTo[]; industry: string | null; skills: string[] };
  connections: ProConnection[];
  incoming: ProConnection[];
  outgoing: ProConnection[];
  recommendationsReceived: ProRecommendation[];
  recommendationsGiven: ProRecommendation[];
  endorsements: { skill: string; count: number; people: ProPerson[] }[];
  opportunities: ProOpportunity[];
  timeline: CareerItem[];
  trust: TrustFactor[];
  suggestions: (AssistantSuggestion & { person: ProPerson; openTo: string[] })[];
  ready: boolean;
  /** when this payload was built: a cached replay keeps the same value (features/ui/use-sticky-state.ts) */
  loadedAt: number;
}

const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

async function people(db: Db, ids: readonly string[]): Promise<Map<string, ProPerson & { suspended: boolean; hidden: boolean }>> {
  const out = new Map<string, ProPerson & { suspended: boolean; hidden: boolean }>();
  const want = [...new Set(ids)];
  for (let i = 0; i < want.length; i += 200) {
    const chunk = want.slice(i, i + 200);
    const [{ data: ps }, { data: ds }] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", chunk),
      db.from("profile_details").select("user_id, headline").in("user_id", chunk),
    ]);
    const head = new Map(((ds ?? []) as Row[]).map((d) => [d.user_id as string, str(d.headline)]));
    for (const p of (ps ?? []) as Row[]) {
      if (!p.handle) continue;
      out.set(p.id as string, {
        id: p.id as string,
        handle: p.handle as string,
        displayName: str(p.display_name) ?? `@${p.handle as string}`,
        avatarUrl: str(p.avatar_url),
        verified: !!p.is_verified,
        headline: head.get(p.id as string) ?? null,
        suspended: !!p.is_suspended,
        hidden: !!p.is_hidden,
      });
    }
  }
  return out;
}

async function blockedWith(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`).limit(2000);
  return new Set(((data ?? []) as Row[]).map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id) as string));
}

async function friendIds(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db.from("friendships").select("user_low, user_high").or(`user_low.eq.${userId},user_high.eq.${userId}`).limit(3000);
  return new Set(((data ?? []) as Row[]).map((f) => (f.user_low === userId ? f.user_high : f.user_low) as string));
}

const plain = (p: ProPerson & { suspended?: boolean; hidden?: boolean }): ProPerson => ({ id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified, headline: p.headline });

function toConnection(r: Row, viewerId: string, who: Map<string, ProPerson>): ProConnection | null {
  const outgoing = r.requester_id === viewerId;
  const other = (outgoing ? r.addressee_id : r.requester_id) as string;
  const person = who.get(other);
  if (!person) return null;
  const addresseeRole = r.addressee_role as ProRole;
  const requesterRole = r.requester_role as ProRole;
  return {
    id: r.id as string,
    person: plain(person),
    theirRole: outgoing ? addresseeRole : requesterRole,
    myRole: outgoing ? requesterRole : addresseeRole,
    customLabel: str(r.custom_label),
    context: str(r.context),
    note: str(r.note),
    status: r.status as string,
    outgoing,
    createdAt: r.created_at as string,
    respondedAt: str(r.responded_at),
  };
}

// ─── The member's own dashboard ──────────────────────────────────────────────

export async function networkDashboard(userId: string, now = new Date()): Promise<NetworkDashboard> {
  const db = createAdminClient();
  const [meP, detailsR, connR, recsR, endR, oppR, creds, blocked, friends] = await Promise.all([
    db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, created_at").eq("id", userId).maybeSingle(),
    db.from("profile_details").select("headline, skills, open_to, industry").eq("user_id", userId).maybeSingle(),
    db.from("pro_connections").select("*").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).in("status", ["pending", "accepted"]).limit(2000),
    db.from("pro_recommendations").select("*").or(`author_id.eq.${userId},subject_id.eq.${userId}`).limit(500),
    db.from("skill_endorsements").select("endorser_id, skill, created_at").eq("subject_id", userId).limit(3000),
    db.from("pro_opportunities").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(50),
    listCredentials(userId),
    blockedWith(db, userId),
    friendIds(db, userId),
  ]);
  const ready = !connR.error && !recsR.error && !endR.error && !oppR.error && !detailsR.error;
  const detailsRow = (detailsR.error ? (await db.from("profile_details").select("headline, skills").eq("user_id", userId).maybeSingle()).data : detailsR.data) as Row | null;
  const skills = Array.isArray(detailsRow?.skills) ? (detailsRow!.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const openTo = (Array.isArray(detailsRow?.open_to) ? (detailsRow!.open_to as string[]) : []).filter(isProOpenTo);
  const mp = meP.data as Row | null;
  const me = {
    id: userId,
    handle: (mp?.handle as string) ?? "",
    displayName: str(mp?.display_name) ?? `@${(mp?.handle as string) ?? ""}`,
    avatarUrl: str(mp?.avatar_url),
    verified: !!mp?.is_verified,
    headline: str(detailsRow?.headline),
    openTo,
    industry: str(detailsRow?.industry),
    skills,
  };

  const connRows = connR.error ? [] : ((connR.data ?? []) as Row[]).filter((r) => !blocked.has((r.requester_id === userId ? r.addressee_id : r.requester_id) as string));
  const recRows = recsR.error ? [] : ((recsR.data ?? []) as Row[]);
  const endRows = endR.error ? [] : ((endR.data ?? []) as Row[]).filter((e) => !blocked.has(e.endorser_id as string));
  const ids = new Set<string>();
  for (const r of connRows) ids.add((r.requester_id === userId ? r.addressee_id : r.requester_id) as string);
  for (const r of recRows) ids.add((r.author_id === userId ? r.subject_id : r.author_id) as string);
  for (const e of endRows) ids.add(e.endorser_id as string);
  const who = await people(db, [...ids]);
  const visible = new Map([...who].filter(([, p]) => !p.suspended));

  const all = connRows.map((r) => toConnection(r, userId, visible)).filter((c): c is ProConnection => !!c);
  const connections = all.filter((c) => c.status === "accepted").sort((a, b) => (b.respondedAt ?? "").localeCompare(a.respondedAt ?? ""));
  const incoming = all.filter((c) => c.status === "pending" && !c.outgoing);
  const outgoing = all.filter((c) => c.status === "pending" && c.outgoing);

  const toRec = (r: Row, other: string): ProRecommendation | null => {
    const person = visible.get(other);
    return person && isRecKind(r.kind) ? { id: r.id as string, person: plain(person), kind: r.kind, body: r.body as string, status: r.status as ProRecommendation["status"], createdAt: r.created_at as string } : null;
  };
  const recommendationsReceived = recRows.filter((r) => r.subject_id === userId).map((r) => toRec(r, r.author_id as string)).filter((x): x is ProRecommendation => !!x);
  const recommendationsGiven = recRows.filter((r) => r.author_id === userId).map((r) => toRec(r, r.subject_id as string)).filter((x): x is ProRecommendation => !!x);

  const bySkill = new Map<string, { skill: string; people: ProPerson[] }>();
  for (const e of endRows) {
    const p = visible.get(e.endorser_id as string);
    if (!p) continue;
    const k = (e.skill as string).toLowerCase();
    const entry = bySkill.get(k) ?? { skill: e.skill as string, people: [] };
    entry.people.push(plain(p));
    bySkill.set(k, entry);
  }
  const endorsements = [...bySkill.values()].map((e) => ({ ...e, count: e.people.length })).sort((a, b) => b.count - a.count);

  const opportunities: ProOpportunity[] = oppR.error ? [] : ((oppR.data ?? []) as Row[]).map((o) => toOpportunity(o, null));

  const timeline = careerTimeline({
    credentials: creds.map((c) => ({ id: c.id, kind: c.kind, title: c.title, organization: c.organization, startedOn: c.startedOn, endedOn: c.endedOn, isCurrent: c.isCurrent })),
    connections: connections.map((c) => ({ id: c.id, name: c.person.displayName, theirRole: c.theirRole, customLabel: c.customLabel, context: c.context, at: c.respondedAt ?? c.createdAt })),
    recommendations: recommendationsReceived.filter((r) => r.status === "shown").map((r) => ({ id: r.id, authorName: r.person.displayName, kind: r.kind, at: r.createdAt })),
    now,
  });

  const trust = trustFactors({
    verified: me.verified,
    hasHeadline: !!me.headline,
    skills: skills.length,
    credentials: creds.length,
    connections: connections.length,
    recommendations: recommendationsReceived.filter((r) => r.status === "shown").length,
    endorsers: new Set(endRows.map((e) => e.endorser_id as string)).size,
    accountDays: mp?.created_at ? Math.floor((now.getTime() - Date.parse(mp.created_at as string)) / 86_400_000) : 0,
  });

  const suggestions = ready
    ? await assistant(db, userId, { openTo, skills, organizations: creds.map((c) => c.organization).filter((o): o is string => !!o), connections: new Set(connections.map((c) => c.person.id)) }, new Set([...all.map((c) => c.person.id), ...blocked, userId]), friends)
    : [];

  return { me, connections, incoming, outgoing, recommendationsReceived, recommendationsGiven, endorsements, opportunities, timeline, trust, suggestions, ready, loadedAt: Date.now() };
}

/** The AI Network Assistant's candidates: people at the same organizations, colleagues of colleagues, and people open to what you are looking for. Bounded reads. */
async function assistant(db: Db, userId: string, me: { openTo: string[]; skills: string[]; organizations: string[]; connections: Set<string> }, exclude: Set<string>, friends: Set<string>): Promise<NetworkDashboard["suggestions"]> {
  const cand = new Set<string>();
  const orgs = [...new Set(me.organizations.map((o) => o.trim()).filter((o) => o.length > 1))].slice(0, 8);
  const [orgR, viaR, openR] = await Promise.all([
    orgs.length ? db.from("profile_credentials").select("user_id, organization").in("organization", orgs).neq("user_id", userId).limit(200) : Promise.resolve({ data: [] }),
    me.connections.size
      ? db.from("pro_connections").select("requester_id, addressee_id").eq("status", "accepted").or(`requester_id.in.(${[...me.connections].slice(0, 100).join(",")}),addressee_id.in.(${[...me.connections].slice(0, 100).join(",")})`).limit(400)
      : Promise.resolve({ data: [] }),
    // people open to what I am looking for
    (() => {
      const want = me.openTo.includes("hiring") ? ["work", "freelance"] : me.openTo.includes("work") || me.openTo.includes("freelance") ? ["hiring"] : me.openTo.includes("mentee") ? ["mentoring"] : me.openTo.includes("mentoring") ? ["mentee"] : me.openTo.includes("investors") ? ["partnerships"] : [];
      return want.length ? db.from("profile_details").select("user_id").overlaps("open_to", want).neq("user_id", userId).limit(150) : Promise.resolve({ data: [] });
    })(),
  ]);
  const orgsOf = new Map<string, string[]>();
  for (const r of (orgR.data ?? []) as Row[]) {
    cand.add(r.user_id as string);
    orgsOf.set(r.user_id as string, [...(orgsOf.get(r.user_id as string) ?? []), r.organization as string]);
  }
  const theirConnections = new Map<string, string[]>();
  for (const r of (viaR.data ?? []) as Row[]) {
    const a = r.requester_id as string;
    const b = r.addressee_id as string;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (me.connections.has(y) && x !== userId) {
        cand.add(x);
        theirConnections.set(x, [...(theirConnections.get(x) ?? []), y]);
      }
    }
  }
  for (const r of (openR.data ?? []) as Row[]) cand.add(r.user_id as string);
  for (const id of exclude) cand.delete(id);
  const ids = [...cand].slice(0, 300);
  if (!ids.length) return [];

  const [{ data: dets }, { data: disc }, who] = await Promise.all([
    db.from("profile_details").select("user_id, skills, open_to").in("user_id", ids),
    db.from("profile_discovery").select("user_id, discoverable").in("user_id", ids),
    people(db, ids),
  ]);
  const hiddenFromDiscovery = new Set(((disc ?? []) as Row[]).filter((d) => d.discoverable === false).map((d) => d.user_id as string));
  const detBy = new Map(((dets ?? []) as Row[]).map((d) => [d.user_id as string, d]));
  const candidates = ids
    .filter((id) => {
      const p = who.get(id);
      return p && !hiddenFromDiscovery.has(id) && isAccountVisibleTo(flagsOf({ is_suspended: p.suspended, is_hidden: p.hidden }), friends.has(id) ? "friend" : "stranger");
    })
    .map((id) => {
      const d = detBy.get(id);
      return {
        id,
        openTo: Array.isArray(d?.open_to) ? (d!.open_to as string[]) : [],
        skills: Array.isArray(d?.skills) ? (d!.skills as unknown[]).filter((s): s is string => typeof s === "string") : [],
        organizations: orgsOf.get(id) ?? [],
        connectedTo: theirConnections.get(id) ?? [],
      };
    });
  const nameCache = new Map<string, string>();
  const nameOf = (id: string) => nameCache.get(id) ?? "someone you know";
  // names of MY connections, for "Worked with Kemi"
  if (me.connections.size) {
    const mine = await people(db, [...me.connections].slice(0, 200));
    for (const [id, p] of mine) nameCache.set(id, p.displayName);
  }
  return networkSuggestions(me, candidates, exclude, nameOf).map((s) => ({ ...s, person: plain(who.get(s.id)!), openTo: candidates.find((c) => c.id === s.id)?.openTo ?? [] }));
}

// ─── Someone's public professional page ──────────────────────────────────────

export interface PublicNetwork {
  person: ProPerson;
  openTo: ProOpenTo[];
  industry: string | null;
  skills: { skill: string; count: number; endorsedByViewer: boolean }[];
  connections: ProConnection[] | null;
  recommendations: ProRecommendation[];
  timeline: CareerItem[];
  opportunities: ProOpportunity[];
  viewer: {
    isOwner: boolean;
    signedIn: boolean;
    connection: { id: string; status: string; outgoing: boolean } | null;
    canVouch: boolean;
    myRecommendationKinds: RecKind[];
  };
  /** when this payload was built: a cached replay keeps the same value (features/ui/use-sticky-state.ts) */
  loadedAt: number;
}

/**
 * What a viewer may see of someone's professional side. null = not visible.
 * getPublicProfile is the one authority on who may see a profile at all (blocks,
 * suspended and hidden accounts, and private or followers-only visibility): a
 * restricted viewer gets "restricted", never the details.
 */
export async function publicNetwork(handle: string, viewerId: string | null, now = new Date()): Promise<PublicNetwork | "restricted" | null> {
  const db = createAdminClient();
  const profile = await getPublicProfile(handle, viewerId);
  if (!profile) return null;
  if (profile.restricted && !profile.isOwner) return "restricted";
  const pid = profile.id;
  const isOwner = profile.isOwner;
  const [friends, blocked] = viewerId ? await Promise.all([friendIds(db, viewerId), blockedWith(db, viewerId)]) : [new Set<string>(), new Set<string>()];
  if (blocked.has(pid)) return null;
  const relation = isOwner ? "self" : friends.has(pid) ? "friend" : "stranger";

  const [detR, endR, recR, connR, oppR, priv, viewerConn, myRecs, identity, stored, creds, circles, friendState] = await Promise.all([
    db.from("profile_details").select("headline, skills, open_to, industry").eq("user_id", pid).maybeSingle(),
    db.from("skill_endorsements").select("endorser_id, skill").eq("subject_id", pid).limit(3000),
    db.from("pro_recommendations").select("*").eq("subject_id", pid).eq("status", "shown").order("created_at", { ascending: false }).limit(50),
    db.from("pro_connections").select("*").or(`requester_id.eq.${pid},addressee_id.eq.${pid}`).eq("status", "accepted").limit(500),
    db.from("pro_opportunities").select("*").eq("owner_id", pid).eq("status", "open").order("created_at", { ascending: false }).limit(20),
    db.from("privacy_settings").select("friends_visibility").eq("user_id", pid).maybeSingle(),
    viewerId && !isOwner ? db.from("pro_connections").select("id, status, requester_id").or(`and(requester_id.eq.${viewerId},addressee_id.eq.${pid}),and(requester_id.eq.${pid},addressee_id.eq.${viewerId})`).in("status", ["pending", "accepted"]).maybeSingle() : Promise.resolve({ data: null }),
    viewerId && !isOwner ? db.from("pro_recommendations").select("kind").eq("author_id", viewerId).eq("subject_id", pid) : Promise.resolve({ data: [] }),
    getProfileIdentity(pid),
    getProfileModules(pid),
    listCredentials(pid),
    viewerCircleIds(pid, viewerId),
    viewerId && !isOwner ? friendshipState(viewerId, pid) : Promise.resolve("none" as const),
  ]);
  const det = (detR.error ? null : detR.data) as Row | null;
  const listed = Array.isArray(det?.skills) ? (det!.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const endRows = endR.error ? [] : ((endR.data ?? []) as Row[]).filter((e) => !blocked.has(e.endorser_id as string));
  const skills = listed.map((s) => {
    const rows = endRows.filter((e) => (e.skill as string).toLowerCase() === s.toLowerCase());
    return { skill: s, count: rows.length, endorsedByViewer: !!viewerId && rows.some((e) => e.endorser_id === viewerId) };
  });

  // Career Timeline: only the credential sections THIS viewer may see on the profile (the profile engine decides)
  const role = resolveViewerRole({ viewerId, isOwner, isAdmin: false, isFriend: friendState === "friends", isFollowing: profile.isFollowing });
  const content: Partial<Record<ModuleKey, boolean>> = {};
  for (const k of Object.values(CREDENTIAL_MODULE)) content[k] = true;
  const layout = resolveProfileLayout({ type: identity.type, stored, landing: null, role, content, allowedGoverned: [], viewerCircles: circles });
  const visibleModules = new Set(layout.modules.map((m) => m.key));
  const shownCreds = creds.filter((c) => visibleModules.has(CREDENTIAL_MODULE[c.kind as CredentialKind]));

  const connRows = connR.error ? [] : ((connR.data ?? []) as Row[]);
  const recRows = recR.error ? [] : ((recR.data ?? []) as Row[]);
  const who = await people(db, [...connRows.map((r) => (r.requester_id === pid ? r.addressee_id : r.requester_id) as string), ...recRows.map((r) => r.author_id as string)]);
  const visibleWho = new Map([...who].filter(([id, x]) => !x.suspended && !blocked.has(id) && (!x.hidden || isOwner || friends.has(id))));
  // their connection list follows the same choice as their friend list (privacy_settings.friends_visibility)
  const fv = ((priv.data as Row | null)?.friends_visibility as string | undefined) ?? "friends";
  const showConnections = isOwner || fv === "public" || (fv === "friends" && relation === "friend");
  const connections = showConnections ? connRows.map((r) => toConnection(r, pid, visibleWho)).filter((c): c is ProConnection => !!c) : null;
  const recommendations = recRows.map((r): ProRecommendation | null => {
    const person = visibleWho.get(r.author_id as string);
    return person && isRecKind(r.kind) ? { id: r.id as string, person: plain(person), kind: r.kind, body: r.body as string, status: "shown" as const, createdAt: r.created_at as string } : null;
  }).filter((x): x is ProRecommendation => !!x);

  const vc = viewerConn.data as Row | null;
  const connectedForReal = vc?.status === "accepted";
  return {
    person: { id: pid, handle: profile.handle, displayName: profile.displayName, avatarUrl: profile.avatarUrl, verified: profile.isVerified, headline: str(det?.headline) },
    openTo: (Array.isArray(det?.open_to) ? (det!.open_to as string[]) : []).filter(isProOpenTo),
    industry: str(det?.industry),
    skills,
    connections,
    recommendations,
    timeline: careerTimeline({
      credentials: shownCreds.map((c) => ({ id: c.id, kind: c.kind, title: c.title, organization: c.organization, startedOn: c.startedOn, endedOn: c.endedOn, isCurrent: c.isCurrent })),
      connections: [],
      recommendations: [],
      now,
    }),
    opportunities: oppR.error ? [] : ((oppR.data ?? []) as Row[]).map((o) => toOpportunity(o, null)),
    viewer: {
      isOwner,
      signedIn: !!viewerId,
      connection: vc ? { id: vc.id as string, status: vc.status as string, outgoing: vc.requester_id === viewerId } : null,
      canVouch: !!viewerId && !isOwner && (connectedForReal || friends.has(pid)),
      myRecommendationKinds: ((myRecs.data ?? []) as Row[]).map((r) => r.kind as RecKind),
    },
    loadedAt: Date.now(),
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

/** The target exists, is visible to the actor, and neither has blocked the other. */
async function reachable(db: Db, actorId: string, targetId: string): Promise<ProPerson | null> {
  if (actorId === targetId) return null;
  const [who, blocked, friends] = await Promise.all([people(db, [targetId]), blockedWith(db, actorId), friendIds(db, actorId)]);
  const p = who.get(targetId);
  if (!p || blocked.has(targetId)) return null;
  if (!isAccountVisibleTo(flagsOf({ is_suspended: p.suspended, is_hidden: p.hidden }), friends.has(targetId) ? "friend" : "stranger")) return null;
  return plain(p);
}

async function canVouch(db: Db, actorId: string, targetId: string): Promise<boolean> {
  const [low, high] = actorId < targetId ? [actorId, targetId] : [targetId, actorId];
  const [{ data: f }, { data: c }] = await Promise.all([
    db.from("friendships").select("user_low").eq("user_low", low).eq("user_high", high).limit(1),
    db.from("pro_connections").select("id").eq("status", "accepted").or(`and(requester_id.eq.${actorId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${actorId})`).limit(1),
  ]);
  return (f ?? []).length > 0 || (c ?? []).length > 0;
}

export async function saveProfessional(userId: string, patch: { openTo?: string[]; industry?: string | null }): Promise<Result> {
  const cols: Row = {};
  if (patch.openTo !== undefined) {
    if (!patch.openTo.every(isProOpenTo)) return fail("Unknown option.");
    cols.open_to = [...new Set(patch.openTo)];
  }
  if (patch.industry !== undefined) {
    const v = validateShortText(patch.industry, 60);
    if (!v.ok) return fail(v.error);
    cols.industry = v.value;
  }
  const { error } = await createAdminClient().from("profile_details").upsert({ user_id: userId, ...cols, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return MISSING(error.message) ? fail("This arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true };
}

export async function requestConnection(userId: string, input: { targetId: string; theirRole: string; myRole: string; customLabel?: string | null; context?: string | null; note?: string | null }): Promise<Result<{ id: string }>> {
  if (!isProRole(input.theirRole) || !isProRole(input.myRole) || !rolePairAllowed(input.theirRole, input.myRole)) return fail("Choose how you worked together.");
  const custom = validateShortText(input.customLabel, CUSTOM_ROLE_MAX);
  if (!custom.ok) return fail(custom.error);
  if ((input.theirRole === "custom") !== !!custom.value) return fail("Name the relationship.");
  const context = validateShortText(input.context, CONTEXT_MAX);
  if (!context.ok) return fail(context.error);
  const note = validateShortText(input.note, NOTE_MAX);
  if (!note.ok) return fail(note.error);
  const db = createAdminClient();
  const target = await reachable(db, userId, input.targetId);
  if (!target) return fail("You can't connect with this person.", 404);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("pro_connections").select("id", { count: "exact", head: true }).eq("requester_id", userId).gte("created_at", since);
  if ((count ?? 0) >= PENDING_REQUESTS_PER_DAY) return fail("You've sent a lot of requests today. Try again tomorrow.", 429);
  const { data, error } = await db
    .from("pro_connections")
    .insert({ requester_id: userId, addressee_id: target.id, addressee_role: input.theirRole, requester_role: input.myRole, custom_label: custom.value, context: context.value, note: note.value })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return fail("There's already a request or connection between you.", 409);
    return MISSING(error.message) ? fail("This arrives with the next update.", 503) : fail("Couldn't send that.", 500);
  }
  await publishNotification({ userId: target.id, type: "pro_request", actorId: userId }).catch(() => {});
  return { ok: true, id: (data as Row).id as string };
}

export async function respondConnection(userId: string, id: string, action: "accept" | "decline" | "withdraw" | "end"): Promise<Result> {
  const db = createAdminClient();
  const { data: r } = await db.from("pro_connections").select("*").eq("id", id).maybeSingle();
  const row = r as Row | null;
  if (!row || ![row.requester_id, row.addressee_id].includes(userId)) return fail("Not found.", 404);
  const isAddressee = row.addressee_id === userId;
  const next =
    action === "accept" && isAddressee && row.status === "pending" ? "accepted"
    : action === "decline" && isAddressee && row.status === "pending" ? "declined"
    : action === "withdraw" && !isAddressee && row.status === "pending" ? "withdrawn"
    : action === "end" && row.status === "accepted" ? "ended"
    : null;
  if (!next) return fail("That can't be done now.", 409);
  const { error } = await db.from("pro_connections").update({ status: next, responded_at: new Date().toISOString() }).eq("id", id).eq("status", row.status as string);
  if (error) return fail("Couldn't save that.", 500);
  if (next === "accepted") await publishNotification({ userId: row.requester_id as string, type: "pro_accepted", actorId: userId }).catch(() => {});
  return { ok: true };
}

export async function writeRecommendation(userId: string, input: { subjectId: string; kind: string; body: string }): Promise<Result> {
  if (!isRecKind(input.kind)) return fail("Choose what you're writing.");
  const v = validateRecommendation(input.body);
  if (!v.ok) return fail(v.error);
  const db = createAdminClient();
  const target = await reachable(db, userId, input.subjectId);
  if (!target) return fail("You can't recommend this person.", 404);
  if (!(await canVouch(db, userId, target.id))) return fail("Only people you're friends with or professionally connected to can be recommended.", 403);
  // an edit goes back to the subject for approval
  const { error } = await db.from("pro_recommendations").upsert({ author_id: userId, subject_id: target.id, kind: input.kind, body: v.value, status: "pending", created_at: new Date().toISOString(), decided_at: null }, { onConflict: "author_id,subject_id,kind" });
  if (error) return MISSING(error.message) ? fail("This arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  await publishNotification({ userId: target.id, type: "pro_recommendation", actorId: userId }).catch(() => {});
  return { ok: true };
}

export async function decideRecommendation(userId: string, id: string, action: "show" | "hide" | "delete"): Promise<Result> {
  const db = createAdminClient();
  const { data } = await db.from("pro_recommendations").select("author_id, subject_id").eq("id", id).maybeSingle();
  const row = data as Row | null;
  if (!row) return fail("Not found.", 404);
  // the subject decides what is shown, the author may withdraw what they wrote
  if (action === "delete" ? ![row.author_id, row.subject_id].includes(userId) : row.subject_id !== userId) return fail("Not found.", 404);
  const { error } =
    action === "delete"
      ? await db.from("pro_recommendations").delete().eq("id", id)
      : await db.from("pro_recommendations").update({ status: action === "show" ? "shown" : "hidden", decided_at: new Date().toISOString() }).eq("id", id);
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

export async function setEndorsement(userId: string, input: { subjectId: string; skill: string; on: boolean }): Promise<Result> {
  const db = createAdminClient();
  if (!input.on) {
    // the endorser takes it back, or the subject removes it from their profile
    const { error } = await db.from("skill_endorsements").delete().eq("subject_id", input.subjectId).ilike("skill", input.skill.replace(/[\\%_]/g, (c) => `\\${c}`)).eq("endorser_id", userId);
    return error ? fail("Couldn't save that.", 500) : { ok: true };
  }
  const target = await reachable(db, userId, input.subjectId);
  if (!target) return fail("You can't endorse this person.", 404);
  if (!(await canVouch(db, userId, target.id))) return fail("Only people you're friends with or professionally connected to can endorse.", 403);
  const { data: det } = await db.from("profile_details").select("skills").eq("user_id", target.id).maybeSingle();
  const listed = Array.isArray((det as Row | null)?.skills) ? ((det as Row).skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const skill = listed.find((s) => s.toLowerCase() === input.skill.trim().toLowerCase());
  if (!skill) return fail("They don't list that skill.");
  const { error } = await db.from("skill_endorsements").insert({ endorser_id: userId, subject_id: target.id, skill });
  if (error && error.code !== "23505") return MISSING(error.message) ? fail("This arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true };
}

/** The subject removes someone's endorsement from their own profile. */
export async function removeEndorsementOfMe(userId: string, endorserId: string, skill: string): Promise<Result> {
  const { error } = await createAdminClient().from("skill_endorsements").delete().eq("subject_id", userId).eq("endorser_id", endorserId).ilike("skill", skill.replace(/[\\%_]/g, (c) => `\\${c}`));
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

// ─── Opportunities ───────────────────────────────────────────────────────────

function toOpportunity(o: Row, owner: ProPerson | null): ProOpportunity {
  return { id: o.id as string, owner, kind: o.kind as string, title: o.title as string, description: str(o.description), location: str(o.location), remote: !!o.remote, link: str(o.link), status: o.status as string, createdAt: o.created_at as string };
}

export async function saveOpportunity(userId: string, input: OpportunityInput & { id?: string; status?: "open" | "closed" }): Promise<Result<{ id: string }>> {
  const db = createAdminClient();
  if (input.id && input.status && !input.title) {
    const { error } = await db.from("pro_opportunities").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", input.id).eq("owner_id", userId);
    return error ? fail("Couldn't save that.", 500) : { ok: true, id: input.id };
  }
  const v = validateOpportunity(input);
  if (!v.ok) return fail(v.error);
  if (!input.id) {
    const { count } = await db.from("pro_opportunities").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("status", "open");
    if ((count ?? 0) >= MAX_OPEN_OPPORTUNITIES) return fail(`Up to ${MAX_OPEN_OPPORTUNITIES} open at once. Close one first.`);
  }
  const cols = { owner_id: userId, ...v.value, status: input.status ?? "open", updated_at: new Date().toISOString() };
  const q = input.id ? db.from("pro_opportunities").update(cols).eq("id", input.id).eq("owner_id", userId).select("id").maybeSingle() : db.from("pro_opportunities").insert(cols).select("id").single();
  const { data, error } = await q;
  if (error || !data) return error && MISSING(error.message) ? fail("This arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true, id: (data as Row).id as string };
}

export async function deleteOpportunity(userId: string, id: string): Promise<Result> {
  const { error } = await createAdminClient().from("pro_opportunities").delete().eq("id", id).eq("owner_id", userId);
  return error ? fail("Couldn't delete that.", 500) : { ok: true };
}

export async function listOpportunities(viewerId: string | null, f: { kind?: string; q?: string; remote?: boolean }): Promise<{ items: ProOpportunity[]; ready: boolean }> {
  const db = createAdminClient();
  let q = db.from("pro_opportunities").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(100);
  if (f.kind && isOpportunityKind(f.kind)) q = q.eq("kind", f.kind);
  if (f.remote) q = q.eq("remote", true);
  if (f.q?.trim()) {
    const t = f.q.trim().replace(/[%_,()]/g, " ").slice(0, 60);
    q = q.or(`title.ilike.%${t}%,description.ilike.%${t}%,location.ilike.%${t}%`);
  }
  const { data, error } = await q;
  if (error) return { items: [], ready: !MISSING(error.message) };
  const rows = (data ?? []) as Row[];
  const [who, blocked, friends] = await Promise.all([people(db, rows.map((r) => r.owner_id as string)), viewerId ? blockedWith(db, viewerId) : Promise.resolve(new Set<string>()), viewerId ? friendIds(db, viewerId) : Promise.resolve(new Set<string>())]);
  const items = rows
    .filter((r) => {
      const p = who.get(r.owner_id as string);
      return p && !blocked.has(p.id) && isAccountVisibleTo(flagsOf({ is_suspended: p.suspended, is_hidden: p.hidden }), p.id === viewerId ? "self" : friends.has(p.id) ? "friend" : "stranger");
    })
    .map((r) => toOpportunity(r, plain(who.get(r.owner_id as string)!)));
  return { items, ready: true };
}

// ─── Professional discovery ──────────────────────────────────────────────────

export interface DiscoverFilter {
  q?: string;
  skill?: string;
  openTo?: string;
  country?: string;
  language?: string;
  industry?: string;
  verified?: boolean;
}

/** Search people by their public professional facts. Respects discovery opt-out, blocks, suspended and hidden accounts. */
export async function discoverProfessionals(viewerId: string, f: DiscoverFilter): Promise<{ people: (ProPerson & { openTo: string[]; skills: string[]; country: string | null; industry: string | null })[]; ready: boolean }> {
  const db = createAdminClient();
  const clean = (s?: string) => s?.trim().replace(/[%_,()"]/g, " ").slice(0, 60) || null;
  let q = db.from("profile_details").select("user_id, headline, skills, open_to, country, industry, languages").neq("user_id", viewerId).limit(200);
  if (f.openTo && isProOpenTo(f.openTo)) q = q.contains("open_to", [f.openTo]);
  const skill = clean(f.skill);
  if (skill) q = q.contains("skills", JSON.stringify([skill]));
  const country = clean(f.country);
  if (country) q = q.ilike("country", `%${country}%`);
  const industry = clean(f.industry);
  if (industry) q = q.ilike("industry", `%${industry}%`);
  const language = clean(f.language);
  if (language) q = q.contains("languages", JSON.stringify([language]));
  const text = clean(f.q);
  if (text) q = q.or(`headline.ilike.%${text}%,category.ilike.%${text}%`);
  const { data, error } = await q;
  if (error) return { people: [], ready: !MISSING(error.message) };
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => r.user_id as string);
  const [who, blocked, friends, { data: disc }] = await Promise.all([
    people(db, ids),
    blockedWith(db, viewerId),
    friendIds(db, viewerId),
    ids.length ? db.from("profile_discovery").select("user_id, discoverable").in("user_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const optedOut = new Set(((disc ?? []) as Row[]).filter((d) => d.discoverable === false).map((d) => d.user_id as string));
  const out = rows
    .filter((r) => {
      const p = who.get(r.user_id as string);
      if (!p || blocked.has(p.id) || optedOut.has(p.id)) return false;
      if (!isAccountVisibleTo(flagsOf({ is_suspended: p.suspended, is_hidden: p.hidden }), friends.has(p.id) ? "friend" : "stranger")) return false;
      return !f.verified || p.verified;
    })
    .map((r) => ({ ...plain(who.get(r.user_id as string)!), openTo: (Array.isArray(r.open_to) ? (r.open_to as string[]) : []).filter(isProOpenTo), skills: Array.isArray(r.skills) ? (r.skills as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 8) : [], country: str(r.country), industry: str(r.industry) }));
  // the most complete profiles first: verified, then open to something, then by skills listed
  out.sort((a, b) => Number(b.verified) - Number(a.verified) || b.openTo.length - a.openTo.length || b.skills.length - a.skills.length);
  return { people: out.slice(0, 60), ready: true };
}

// ─── Network export ──────────────────────────────────────────────────────────

/** Everything about the member's professional side, both directions, as JSON. */
export async function exportNetwork(userId: string): Promise<Record<string, unknown>> {
  const d = await networkDashboard(userId);
  const creds = await listCredentials(userId);
  return {
    exportedAt: new Date().toISOString(),
    profile: { handle: d.me.handle, headline: d.me.headline, industry: d.me.industry, skills: d.me.skills, openTo: d.me.openTo, businessCard: `/u/${d.me.handle}/card` },
    credentials: creds.map((c) => ({ kind: c.kind, title: c.title, organization: c.organization, started: c.startedOn, ended: c.isCurrent ? "present" : c.endedOn, url: c.url })),
    connections: d.connections.map((c) => ({ handle: c.person.handle, name: c.person.displayName, theyAre: c.theirRole === "custom" ? c.customLabel : c.theirRole, youAre: c.myRole, context: c.context, since: c.respondedAt })),
    recommendationsReceived: d.recommendationsReceived.map((r) => ({ from: r.person.handle, kind: r.kind, status: r.status, text: r.body, at: r.createdAt })),
    recommendationsGiven: d.recommendationsGiven.map((r) => ({ to: r.person.handle, kind: r.kind, status: r.status, text: r.body, at: r.createdAt })),
    endorsements: d.endorsements.map((e) => ({ skill: e.skill, by: e.people.map((p) => p.handle) })),
    opportunities: d.opportunities.map((o) => ({ kind: o.kind, title: o.title, status: o.status, location: o.location, remote: o.remote, link: o.link })),
  };
}
