import "server-only";

import { after } from "next/server";

import { publishNotification } from "@/lib/notifications/publish";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { getPublicProfile } from "@/lib/social/profile";
import { isUuid } from "@/lib/sub/guards";
import { getSubSettings, quoteSub, subEarnings, type SubEarnings, type SubQuote, type SubSettings } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  aggregate,
  communitySuggestions,
  feedbackSummary,
  FEEDBACK_ASPECTS,
  isMemberRole,
  isRecognition,
  isSponsorKind,
  joinsByMonth,
  loyaltyNotes,
  memberMilestone,
  membersCsv,
  retention,
  ROLE_RANK,
  validatePlain,
  type CommunitySuggestion,
  type FeedbackAspect,
  type MemberRole,
  type MemberSignals,
  type Recognition,
  type SponsorKind,
} from "./engine";

/**
 * Creator Relationship Platform™ — the community side (Feature 19 · Part 13).
 *
 * Two ways to belong to a creator (0227 `creator_memberships`):
 *   free member    a community member, when the creator is open to it
 *   subscriber     paid through SUB (lib/sub/server.ts): access runs to the paid-through
 *                  time and simply ends then — every read checks `period_end`, so no
 *                  renewal job and no charge without the subscriber paying again
 *
 * The money (prices, fees, payments, earnings, withdrawals) is SUB's, never
 * AI credits; this file only reads it for the creator's dashboard.
 */

type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
/** A note for the creator's community (every note before 0251). Subscriber announcements and deleted rows are not. */
export const isMembersNote = (n: Row) => (n.audience ?? "members") === "members" && !n.deleted_at;

export interface Person {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface Membership {
  id: string;
  creatorId: string;
  memberId: string;
  role: MemberRole;
  status: "active" | "lapsed" | "ended" | "removed";
  billing: "free" | "sub";
  priceCents: number;
  periodEnd: string | null;
  joinedAt: string;
  endedAt: string | null;
  /** active now: a free member, or a subscriber whose paid time hasn't run out */
  current: boolean;
}

function toMembership(r: Row, now = Date.now()): Membership {
  const status = (["active", "lapsed", "ended", "removed"].includes(r.status as string) ? r.status : "ended") as Membership["status"];
  const billing = r.billing === "sub" ? "sub" : "free";
  const periodEnd = str(r.period_end);
  const current = status === "active" && (billing === "free" || (!!periodEnd && Date.parse(periodEnd) > now));
  return { id: r.id as string, creatorId: r.creator_id as string, memberId: r.member_id as string, role: isMemberRole(r.role) ? r.role : "member", status, billing, priceCents: Number(r.price_cents ?? 0), periodEnd, joinedAt: r.joined_at as string, endedAt: str(r.ended_at), current };
}

async function people(db: Db, ids: readonly string[]): Promise<Map<string, Person & { suspended: boolean; hidden: boolean }>> {
  const out = new Map<string, Person & { suspended: boolean; hidden: boolean }>();
  const want = [...new Set(ids)];
  for (let i = 0; i < want.length; i += 200) {
    const { data } = await db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", want.slice(i, i + 200));
    for (const p of (data ?? []) as Row[]) {
      if (!p.handle) continue;
      out.set(p.id as string, { id: p.id as string, handle: p.handle as string, displayName: str(p.display_name) ?? `@${p.handle as string}`, avatarUrl: str(p.avatar_url), verified: !!p.is_verified, suspended: !!p.is_suspended, hidden: !!p.is_hidden });
    }
  }
  return out;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number; reason?: string };
const fail = (error: string, status = 400, reason?: string): { ok: false; error: string; status: number; reason?: string } => ({ ok: false, error, status, reason });

// ─── The public membership page ──────────────────────────────────────────────

export interface CreatorPage {
  creator: Person;
  open: boolean;
  welcome: string | null;
  quote: SubQuote | null;
  sponsors: { id: string; name: string; kind: SponsorKind; url: string | null }[];
  viewer: {
    signedIn: boolean;
    isCreator: boolean;
    membership: Membership | null;
    milestone: { label: string; at: string } | null;
    recognitions: Recognition[];
    notes: { id: string; body: string; createdAt: string }[];
    feedback: Partial<Record<FeedbackAspect, number | null>> | null;
  };
  ready: boolean;
  loadedAt: number;
}

export async function creatorPage(handle: string, viewerId: string | null): Promise<CreatorPage | "restricted" | null> {
  const profile = await getPublicProfile(handle, viewerId);
  if (!profile) return null;
  if (profile.restricted && !profile.isOwner) return "restricted";
  const db = createAdminClient();
  const cid = profile.id;
  const [settings, quote, sponsorsR, mR] = await Promise.all([
    getSubSettings(cid),
    quoteSub(cid),
    db.from("creator_sponsors").select("id, name, kind, url").eq("creator_id", cid).order("created_at").limit(30),
    viewerId && !profile.isOwner ? db.from("creator_memberships").select("*").eq("creator_id", cid).eq("member_id", viewerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const membership = mR.data ? toMembership(mR.data as Row) : null;
  const isMember = !!membership?.current;
  const [notesR, recR, fbR] = await Promise.all([
    isMember ? db.from("creator_notes").select("*").eq("creator_id", cid).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [], error: null }),
    isMember ? db.from("creator_recognitions").select("kind").eq("creator_id", cid).eq("member_id", viewerId!).eq("shown", true) : Promise.resolve({ data: [], error: null }),
    membership ? db.from("creator_feedback").select("*").eq("creator_id", cid).eq("member_id", viewerId!).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const rank = membership ? ROLE_RANK[membership.role] : -1;
  return {
    creator: { id: cid, handle: profile.handle, displayName: profile.displayName, avatarUrl: profile.avatarUrl, verified: profile.isVerified },
    open: settings.open,
    welcome: settings.welcome,
    quote,
    sponsors: sponsorsR.error ? [] : ((sponsorsR.data ?? []) as Row[]).map((s) => ({ id: s.id as string, name: s.name as string, kind: (isSponsorKind(s.kind) ? s.kind : "brand") as SponsorKind, url: str(s.url) })),
    viewer: {
      signedIn: !!viewerId,
      isCreator: profile.isOwner,
      membership,
      milestone: isMember ? memberMilestone(membership!.joinedAt, new Date()) : null,
      recognitions: ((recR.data ?? []) as Row[]).map((r) => r.kind).filter(isRecognition),
      // Part 6 (0251): only MEMBERS notes here — a subscriber announcement is read through its own access check (lib/sub/announcements.ts), never by a free member
      notes: ((notesR.data ?? []) as Row[]).filter(isMembersNote).filter((n) => isMemberRole(n.min_role) && rank >= ROLE_RANK[n.min_role]).map((n) => ({ id: n.id as string, body: n.body as string, createdAt: n.created_at as string })),
      feedback: fbR.data ? (Object.fromEntries((Object.keys(FEEDBACK_ASPECTS) as FeedbackAspect[]).map((k) => [k, ((fbR.data as Row)[k] as number | null) ?? null])) as Partial<Record<FeedbackAspect, number | null>>) : null,
    },
    ready: settings.ready,
    loadedAt: Date.now(),
  };
}

// ─── Member actions ──────────────────────────────────────────────────────────

/** Join a creator's FREE community. A paid subscription goes through SUB checkout instead. */
export async function joinFree(memberId: string, creatorId: string): Promise<Result<{ membership: Membership }>> {
  // both ids go into a filter string below (Part 2: each helper checks for itself)
  if (!isUuid(memberId) || !isUuid(creatorId)) return fail("Invalid request.");
  if (memberId === creatorId) return fail("You can't join your own community.");
  const db = createAdminClient();
  const [settings, who, { data: blocked }] = await Promise.all([
    getSubSettings(creatorId),
    people(db, [creatorId]),
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${memberId},blocked_id.eq.${creatorId}),and(blocker_id.eq.${creatorId},blocked_id.eq.${memberId})`).limit(1),
  ]);
  if (!settings.ready) return fail("Memberships arrive with the next update.", 503);
  const creator = who.get(creatorId);
  if (!creator || (blocked ?? []).length || !isAccountVisibleTo(flagsOf({ is_suspended: creator.suspended, is_hidden: creator.hidden }), "stranger")) return fail("You can't join this community.", 404);
  if (!settings.open) return fail("This creator isn't taking free members.", 409);
  const { data: existing } = await db.from("creator_memberships").select("*").eq("creator_id", creatorId).eq("member_id", memberId).maybeSingle();
  const m = existing ? toMembership(existing as Row) : null;
  if (m?.status === "removed") return fail("The creator removed you from this community.", 403);
  if (m?.current) return { ok: true, membership: m };
  const { error } = await db.from("creator_memberships").upsert({ creator_id: creatorId, member_id: memberId, status: "active", billing: "free", price_cents: 0, period_end: null, ended_at: null, joined_at: new Date().toISOString() }, { onConflict: "creator_id,member_id" });
  if (error) return fail("Couldn't join.", 500);
  await publishNotification({ userId: creatorId, type: "member_joined", actorId: memberId }).catch(() => {});
  // owner 2026-10-11: push and email too, past the response
  after(() => import("@/lib/sub/notify").then((m) => m.notifyJoinedFree(creatorId, memberId)));
  const { data: joined } = await db.from("creator_memberships").select("*").eq("creator_id", creatorId).eq("member_id", memberId).maybeSingle();
  return { ok: true, membership: toMembership(joined as Row) };
}

/**
 * Leave. A FREE membership ends now. A PAID subscription with time left is cancelled at the end
 * of its period (Frenz Exclusive Part 5, owner 2026-10-16): the subscriber keeps the access they
 * paid for, nothing is refunded, nothing renews. Only an already-expired paid row is ended here.
 */
export async function leave(memberId: string, creatorId: string): Promise<Result<{ cancelled?: boolean; periodEnd?: string | null }>> {
  if (!isUuid(memberId) || !isUuid(creatorId)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data: row, error: readError } = await db.from("creator_memberships").select("status, billing, period_end").eq("creator_id", creatorId).eq("member_id", memberId).maybeSingle();
  if (readError) return fail("Couldn't save that.", 500);
  const r = row as Row | null;
  if (r?.billing === "sub" && r.status === "active" && typeof r.period_end === "string" && Date.parse(r.period_end) > Date.now()) {
    const { cancelSubscription } = await import("@/lib/sub/subscriptions");
    const out = await cancelSubscription(memberId, creatorId);
    return out.ok ? { ok: true, cancelled: true, periodEnd: out.periodEnd } : out;
  }
  const { error } = await db.from("creator_memberships").update({ status: "ended", ended_at: new Date().toISOString() }).eq("creator_id", creatorId).eq("member_id", memberId).in("status", ["active", "lapsed"]);
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

export async function saveFeedback(memberId: string, creatorId: string, ratings: Partial<Record<FeedbackAspect, number | null>>): Promise<Result> {
  const db = createAdminClient();
  const { data: m } = await db.from("creator_memberships").select("status").eq("creator_id", creatorId).eq("member_id", memberId).maybeSingle();
  if (!m) return fail("Only members can rate a creator.", 403);
  const cols: Row = {};
  for (const k of Object.keys(FEEDBACK_ASPECTS) as FeedbackAspect[]) {
    const v = ratings[k];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 5)) return fail("Ratings are 1 to 5.");
    cols[k] = v;
  }
  const { error } = await db.from("creator_feedback").upsert({ creator_id: creatorId, member_id: memberId, ...cols, updated_at: new Date().toISOString() }, { onConflict: "creator_id,member_id" });
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

/** Memberships and subscriptions the viewer holds. */
export async function myMemberships(memberId: string): Promise<{ membership: Membership; creator: Person }[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("creator_memberships").select("*").eq("member_id", memberId).order("joined_at", { ascending: false }).limit(200);
  if (error) return [];
  const rows = ((data ?? []) as Row[]).map((r) => toMembership(r)).filter((m) => m.billing === "free" || m.periodEnd);
  const who = await people(db, rows.map((m) => m.creatorId));
  return rows.filter((m) => who.get(m.creatorId)).map((m) => ({ membership: m, creator: who.get(m.creatorId)! }));
}

// ─── The creator's dashboard ─────────────────────────────────────────────────

export interface MemberRow {
  membership: Membership;
  person: Person;
  country: string | null;
  languages: string[];
  recognitions: Recognition[];
  loyalty: string[];
}

export interface CreatorDashboard {
  settings: SubSettings;
  quote: SubQuote | null;
  members: MemberRow[];
  notes: { id: string; body: string; minRole: MemberRole; createdAt: string }[];
  sponsors: CreatorPage["sponsors"];
  insights: {
    active: number;
    subscribers: number;
    joins: { month: string; count: number }[];
    retention30: { kept: number; of: number } | null;
    retention90: { kept: number; of: number } | null;
    countries: { label: string; count: number }[];
    languages: { label: string; count: number }[];
  };
  earnings: SubEarnings;
  feedback: { aspect: FeedbackAspect; average: number; answers: number }[] | null;
  assistant: CommunitySuggestion[];
  ready: boolean;
  loadedAt: number;
}

export async function creatorDashboard(creatorId: string, now = new Date()): Promise<CreatorDashboard> {
  const db = createAdminClient();
  const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [settings, quote, earnings, memR, notesR, sponsorsR, fbR, recR, postsR, subPostR] = await Promise.all([
    getSubSettings(creatorId),
    quoteSub(creatorId),
    subEarnings(creatorId),
    db.from("creator_memberships").select("*").eq("creator_id", creatorId).order("joined_at", { ascending: false }).limit(2000),
    db.from("creator_notes").select("*").eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(50),
    db.from("creator_sponsors").select("id, name, kind, url").eq("creator_id", creatorId).order("created_at").limit(30),
    db.from("creator_feedback").select("*").eq("creator_id", creatorId).limit(2000),
    db.from("creator_recognitions").select("member_id, kind").eq("creator_id", creatorId).limit(5000),
    db.from("posts").select("id, created_at").eq("publisher_id", creatorId).gte("created_at", since90).order("created_at", { ascending: false }).limit(200),
    db.from("sub_posts").select("created_at").eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(1),
  ]);
  const ready = settings.ready && !memR.error;
  const memberships = (memR.error ? [] : ((memR.data ?? []) as Row[])).map((r) => toMembership(r, now.getTime())).filter((m) => m.billing === "free" || m.periodEnd);
  const ids = memberships.map((m) => m.memberId);
  const [who, detR] = await Promise.all([people(db, ids), ids.length ? db.from("profile_details").select("user_id, country, languages").in("user_id", ids.slice(0, 2000)) : Promise.resolve({ data: [] })]);
  const det = new Map(((detR.data ?? []) as Row[]).map((d) => [d.user_id as string, d]));
  const recs = new Map<string, Recognition[]>();
  for (const r of (recR.data ?? []) as Row[]) if (isRecognition(r.kind)) recs.set(r.member_id as string, [...(recs.get(r.member_id as string) ?? []), r.kind]);

  const postIds = ((postsR.data ?? []) as Row[]).map((p) => p.id as string);
  const current = memberships.filter((m) => m.current);
  const currentIds = current.map((m) => m.memberId).slice(0, 1000);
  const [commentsR, collabR] = await Promise.all([
    postIds.length && currentIds.length ? db.from("post_comments").select("author_id, created_at").in("post_id", postIds).in("author_id", currentIds).gte("created_at", since90).limit(5000) : Promise.resolve({ data: [] }),
    currentIds.length ? db.from("post_collaborators").select("user_id").eq("invited_by", creatorId).eq("status", "accepted").in("user_id", currentIds).limit(2000) : Promise.resolve({ data: [] }),
  ]);
  const comments = new Map<string, { n: number; last: string | null }>();
  for (const c of (commentsR.data ?? []) as Row[]) {
    const e = comments.get(c.author_id as string) ?? { n: 0, last: null };
    e.n++;
    if (!e.last || (c.created_at as string) > e.last) e.last = c.created_at as string;
    comments.set(c.author_id as string, e);
  }
  const collabs = new Map<string, number>();
  for (const c of (collabR.data ?? []) as Row[]) collabs.set(c.user_id as string, (collabs.get(c.user_id as string) ?? 0) + 1);
  const signals = (m: Membership): MemberSignals => ({ memberId: m.memberId, joinedAt: m.joinedAt, comments90: comments.get(m.memberId)?.n ?? 0, collaborations: collabs.get(m.memberId) ?? 0, recognitions: recs.get(m.memberId) ?? [], upheldReports: 0, lastActiveAt: comments.get(m.memberId)?.last ?? null });

  const members: MemberRow[] = memberships
    .filter((m) => who.get(m.memberId) && !who.get(m.memberId)!.suspended)
    .map((m) => {
      const d = det.get(m.memberId);
      const p = who.get(m.memberId)!;
      return {
        membership: m,
        person: { id: p.id, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl, verified: p.verified },
        country: str(d?.country),
        languages: Array.isArray(d?.languages) ? (d!.languages as unknown[]).filter((l): l is string => typeof l === "string") : [],
        recognitions: recs.get(m.memberId) ?? [],
        loyalty: m.current ? loyaltyNotes(signals(m), now.getTime()) : [],
      };
    });
  const currentRows = members.filter((m) => m.membership.current);
  const lastNote = ((notesR.data ?? []) as Row[]).filter(isMembersNote)[0]?.created_at as string | undefined;
  const lastPost = [((postsR.data ?? []) as Row[])[0]?.created_at, ((subPostR.data ?? []) as Row[])[0]?.created_at].filter((x): x is string => typeof x === "string").sort().pop();
  const nowMs = now.getTime();
  const ended = (m: MemberRow) => (m.membership.current ? null : (m.membership.endedAt ?? m.membership.periodEnd));
  return {
    settings,
    quote,
    members,
    notes: ((notesR.data ?? []) as Row[]).filter(isMembersNote).map((n) => ({ id: n.id as string, body: n.body as string, minRole: (isMemberRole(n.min_role) ? n.min_role : "member") as MemberRole, createdAt: n.created_at as string })),
    sponsors: sponsorsR.error ? [] : ((sponsorsR.data ?? []) as Row[]).map((s) => ({ id: s.id as string, name: s.name as string, kind: (isSponsorKind(s.kind) ? s.kind : "brand") as SponsorKind, url: str(s.url) })),
    insights: {
      active: currentRows.length,
      subscribers: currentRows.filter((m) => m.membership.billing === "sub").length,
      joins: joinsByMonth(members.map((m) => m.membership.joinedAt), now),
      retention30: retention(members.map((m) => ({ joinedAt: m.membership.joinedAt, endedAt: ended(m) })), 30, nowMs),
      retention90: retention(members.map((m) => ({ joinedAt: m.membership.joinedAt, endedAt: ended(m) })), 90, nowMs),
      countries: aggregate(currentRows.map((m) => m.country)),
      languages: aggregate(currentRows.flatMap((m) => m.languages)),
    },
    earnings,
    feedback: fbR.error ? null : feedbackSummary((fbR.data ?? []) as Partial<Record<FeedbackAspect, number | null>>[]),
    assistant: communitySuggestions({ members: currentRows.map((m) => ({ ...signals(m.membership), role: m.membership.role })), lastNoteAt: lastNote ?? null, lastPostAt: lastPost ?? null, now: nowMs }),
    ready,
    loadedAt: Date.now(),
  };
}

// ─── Creator actions ─────────────────────────────────────────────────────────

export async function setMemberRole(creatorId: string, memberId: string, role: string): Promise<Result> {
  if (!isMemberRole(role)) return fail("Unknown role.");
  const { error } = await createAdminClient().from("creator_memberships").update({ role }).eq("creator_id", creatorId).eq("member_id", memberId);
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

/** The creator removes someone: access ends now. A refund, if due, is an admin reversal of the payment. */
export async function removeMember(creatorId: string, memberId: string): Promise<Result> {
  const { error } = await createAdminClient().from("creator_memberships").update({ status: "removed", ended_at: new Date().toISOString() }).eq("creator_id", creatorId).eq("member_id", memberId);
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

export async function setRecognition(creatorId: string, memberId: string, kind: string, on: boolean, shown = false): Promise<Result> {
  if (!isRecognition(kind)) return fail("Unknown recognition.");
  const db = createAdminClient();
  const { error } = on ? await db.from("creator_recognitions").upsert({ creator_id: creatorId, member_id: memberId, kind, shown }, { onConflict: "creator_id,member_id,kind" }) : await db.from("creator_recognitions").delete().eq("creator_id", creatorId).eq("member_id", memberId).eq("kind", kind);
  return error ? fail("Couldn't save that.", 500) : { ok: true };
}

export async function addNote(creatorId: string, body: string, minRole: string): Promise<Result<{ id: string }>> {
  if (!isMemberRole(minRole)) return fail("Choose who it's for.");
  const v = validatePlain(body, 1, 2000, "note");
  if (!v.ok) return fail(v.error);
  const { data, error } = await createAdminClient().from("creator_notes").insert({ creator_id: creatorId, body: v.value, min_role: minRole }).select("id").single();
  if (error) return MISSING(error.message) ? fail("Creator notes arrive with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true, id: (data as Row).id as string };
}

export async function deleteNote(creatorId: string, id: string): Promise<Result> {
  const db = createAdminClient();
  // Part 6: a subscriber announcement is deleted (soft, audited) from the Exclusive tab, never hard-deleted here
  const { data: row } = await db.from("creator_notes").select("*").eq("id", id).eq("creator_id", creatorId).maybeSingle();
  if (row && !isMembersNote(row as Row)) return fail("Delete announcements from your Exclusive tab.", 409);
  const { error } = await db.from("creator_notes").delete().eq("id", id).eq("creator_id", creatorId);
  return error ? fail("Couldn't delete that.", 500) : { ok: true };
}

export async function saveSponsor(creatorId: string, s: { name: string; kind: string; url?: string | null }): Promise<Result<{ id: string }>> {
  const name = validatePlain(s.name, 1, 60, "sponsor name");
  if (!name.ok) return fail(name.error);
  if (!isSponsorKind(s.kind)) return fail("Choose the kind of sponsor.");
  const url = s.url?.trim() || null;
  if (url && (!/^https:\/\//.test(url) || url.length > 300)) return fail("Use an https:// link.");
  const { data, error } = await createAdminClient().from("creator_sponsors").insert({ creator_id: creatorId, name: name.value, kind: s.kind, url }).select("id").single();
  return error ? fail("Couldn't save that.", 500) : { ok: true, id: (data as Row).id as string };
}

export async function deleteSponsor(creatorId: string, id: string): Promise<Result> {
  const { error } = await createAdminClient().from("creator_sponsors").delete().eq("id", id).eq("creator_id", creatorId);
  return error ? fail("Couldn't delete that.", 500) : { ok: true };
}

export async function exportMembers(creatorId: string): Promise<string> {
  const d = await creatorDashboard(creatorId);
  return membersCsv(d.members.map((m) => ({ handle: m.person.handle, name: m.person.displayName, role: m.membership.role, tier: m.membership.billing === "sub" ? "Subscriber" : "Free member", status: m.membership.current ? "active" : m.membership.status === "active" ? "expired" : m.membership.status, joinedAt: m.membership.joinedAt, country: m.country })));
}
