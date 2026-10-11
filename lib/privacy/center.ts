import "server-only";

import { listMyInvites } from "@/lib/creator/collab";
import type { CollabInvite } from "@/lib/creator/collab-types";
import { getPrivacySettings, type PrivacySettings } from "@/lib/social/profile";
import { createAdminClient } from "@/lib/supabase/admin";

import { BOUNDARY_MODES, BUNDLE_KEYS, nextMondayMorning, PRESETS, privacyAdvice, restoreFor, type Advice } from "./relationship";

/**
 * Relationship Privacy Center™ (Feature 19 · Part 17) — reads and writes.
 *
 * Every write goes to the member's own privacy_settings row (the one every
 * enforcement path already reads), so a preset or a Boundary Mode takes effect
 * everywhere at once, and the 0232 trigger records each change in the member's
 * private audit log. A Boundary Mode keeps the settings it replaced and the
 * reconcile cron puts them back when its time is up.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

export interface PrivacyCenter {
  settings: PrivacySettings;
  counts: { blocked: number; muted: number; restricted: number; trusted: number };
  temporaryBlocks: { id: string; name: string; handle: string; until: string }[];
  consents: {
    collabInvites: CollabInvite[];
    proRequests: { id: string; name: string; handle: string; at: string }[];
    memories: { id: string; title: string; ownerName: string; ownerHandle: string; date: string }[];
  };
  advice: Advice[];
  ready: boolean;
}

async function people(db: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Map<string, { name: string; handle: string }>> {
  if (!ids.length) return new Map();
  const { data } = await db.from("profiles").select("id, handle, display_name").in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as Row[]).filter((p) => p.handle).map((p) => [p.id as string, { name: ((p.display_name as string) || `@${p.handle as string}`).slice(0, 60), handle: p.handle as string }]));
}

export async function privacyCenter(userId: string): Promise<PrivacyCenter> {
  const db = createAdminClient();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const head = (q: PromiseLike<{ count: number | null; error: unknown }>) => q.then((r) => (r.error ? 0 : (r.count ?? 0)));
  const [settings, blocked, muted, restricted, trusted, temp, invites, pro, mem, oldSent, staleCollabs, me] = await Promise.all([
    getPrivacySettings(userId),
    head(db.from("blocks").select("blocked_id", { count: "exact", head: true }).eq("blocker_id", userId)),
    head(db.from("muted_creators").select("muted_id", { count: "exact", head: true }).eq("muter_id", userId)),
    head(db.from("user_restrictions").select("restricted_id", { count: "exact", head: true }).eq("restrictor_id", userId)),
    head(db.from("trusted_contacts").select("id", { count: "exact", head: true }).eq("owner_id", userId)),
    db.from("blocks").select("blocked_id, expires_at").eq("blocker_id", userId).not("expires_at", "is", null).order("expires_at").limit(50),
    listMyInvites(userId, "pending"),
    db.from("pro_connections").select("id, requester_id, created_at").eq("addressee_id", userId).eq("status", "pending").limit(50),
    db.from("memory_people").select("memory_id, memories!inner(id, title, owner_id, occurred_on, deleted_at, visibility)").eq("user_id", userId).is("memories.deleted_at", null).limit(200),
    head(db.from("friend_requests").select("id", { count: "exact", head: true }).eq("sender_id", userId).eq("status", "pending").lt("created_at", monthAgo)),
    head(db.from("post_collaborators").select("post_id", { count: "exact", head: true }).eq("status", "accepted").or(`user_id.eq.${userId},invited_by.eq.${userId}`).lt("created_at", yearAgo)),
    db.from("profiles").select("avatar_url").eq("id", userId).maybeSingle(),
  ]);
  const tempRows = temp.error ? [] : ((temp.data ?? []) as Row[]);
  const proRows = (pro.data ?? []) as Row[];
  const memRows = mem.error ? [] : ((mem.data ?? []) as Row[]);
  const who = await people(db, [...tempRows.map((t) => t.blocked_id as string), ...proRows.map((p) => p.requester_id as string), ...memRows.map((m) => (m.memories as Row).owner_id as string)]);
  const filters = settings.request_filters ?? {};
  const soon = Date.now() + 86_400_000;
  return {
    settings,
    counts: { blocked, muted, restricted, trusted },
    temporaryBlocks: tempRows.flatMap((t) => {
      const p = who.get(t.blocked_id as string);
      return p ? [{ id: t.blocked_id as string, name: p.name, handle: p.handle, until: t.expires_at as string }] : [];
    }),
    consents: {
      collabInvites: invites,
      proRequests: proRows.flatMap((p) => {
        const w = who.get(p.requester_id as string);
        return w ? [{ id: p.id as string, name: w.name, handle: w.handle, at: p.created_at as string }] : [];
      }),
      memories: memRows.flatMap((m) => {
        const mm = m.memories as Row;
        const o = who.get(mm.owner_id as string);
        return o && mm.visibility !== "private" ? [{ id: mm.id as string, title: mm.title as string, ownerName: o.name, ownerHandle: o.handle, date: String(mm.occurred_on).slice(0, 10) }] : [];
      }),
    },
    advice: privacyAdvice({
      messagesPolicy: settings.messages_policy,
      friendsVisibility: (settings as unknown as Row).friends_visibility as string,
      lastSeen: ((settings as unknown as Row).last_seen_visibility as string) ?? "everyone",
      mentionPolicy: settings.mention_policy,
      trustedContacts: trusted,
      pendingSentOld: oldSent,
      staleCollaborators: staleCollabs,
      tempBlocksEndingSoon: tempRows.filter((t) => Date.parse(t.expires_at as string) < soon).length,
      hasAvatar: !!(me.data as Row | null)?.avatar_url,
      inRecommendations: settings.show_in_recommendations,
      requestFiltersOn: !!(filters.noPhoto || filters.minAccountDays),
    }),
    ready: !temp.error || !MISSING((temp.error as { message: string }).message),
  };
}

// ─── Presets and Boundary Modes ─────────────────────────────────────────────

async function writeSettings(userId: string, cols: Row): Promise<Result> {
  const { error } = await createAdminClient().from("privacy_settings").upsert({ user_id: userId, ...cols, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return MISSING(error.message) ? fail("These controls arrive with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true };
}

export async function applyPreset(userId: string, key: string): Promise<Result> {
  const p = PRESETS[key];
  if (!p) return fail("Unknown preset.");
  // a preset ends any Boundary Mode: the member is choosing a new everyday baseline
  return writeSettings(userId, { ...p.bundle, boundary_mode: null, boundary_until: null, boundary_restore: null });
}

export async function startBoundary(userId: string, mode: string, hours: number | null): Promise<Result<{ until: string | null }>> {
  const m = BOUNDARY_MODES[mode];
  if (!m) return fail("Unknown mode.");
  const db = createAdminClient();
  const current = (await getPrivacySettings(userId)) as unknown as Row;
  // switching modes keeps the ORIGINAL settings to return to, not the previous mode's
  const { data: row } = await db.from("privacy_settings").select("boundary_restore").eq("user_id", userId).maybeSingle();
  const prior = ((row as Row | null)?.boundary_restore as Row | null) ?? null;
  const restore = { ...restoreFor(current, m.bundle), ...(prior ?? {}) };
  const until = mode === "weekend" ? nextMondayMorning(new Date()).toISOString() : hours ? new Date(Date.now() + Math.min(24 * 30, Math.max(1, hours)) * 3_600_000).toISOString() : null;
  const out = await writeSettings(userId, { ...m.bundle, boundary_mode: mode, boundary_until: until, boundary_restore: restore });
  return out.ok ? { ok: true, until } : out;
}

export async function endBoundary(userId: string): Promise<Result> {
  const db = createAdminClient();
  const { data, error } = await db.from("privacy_settings").select("boundary_restore").eq("user_id", userId).maybeSingle();
  if (error) return fail("Couldn't end it.", 500);
  const restore = ((data as Row | null)?.boundary_restore as Row | null) ?? {};
  const back: Row = {};
  for (const k of BUNDLE_KEYS) if (k in restore && restore[k] !== null) back[k] = restore[k];
  return writeSettings(userId, { ...back, boundary_mode: null, boundary_until: null, boundary_restore: null });
}

// ─── Consent ────────────────────────────────────────────────────────────────

/** Withdraw consent: take yourself off someone's shared memory. The owner sees it in their history. */
export async function removeMeFromMemory(userId: string, memoryId: string): Promise<Result> {
  const db = createAdminClient();
  const { data: m } = await db.from("memories").select("owner_id").eq("id", memoryId).maybeSingle();
  const { data, error } = await db.from("memory_people").delete().eq("memory_id", memoryId).eq("user_id", userId).select("memory_id");
  if (error) return fail("Couldn't remove you.", 500);
  if (!(data ?? []).length) return fail("You're not on that memory.", 404);
  const owner = (m as Row | null)?.owner_id as string | undefined;
  if (owner) await db.rpc("graph_history_add", { p_user: owner, p_other: userId, p_kind: "removed_from_memory", p_detail: null }).then(undefined, () => {});
  return { ok: true };
}

// ─── The reconcile cron ─────────────────────────────────────────────────────

/** Ends temporary blocks and mutes whose time is up, and Boundary Modes that have run their course. Bounded; one indexed read each when idle. */
export async function sweepPrivacyExpiry(limit = 200): Promise<{ blocks: number; mutes: number; boundaries: number }> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const [b, m, due] = await Promise.all([
    db.from("blocks").delete().lt("expires_at", now).select("blocker_id").limit(limit),
    db.from("muted_creators").delete().lt("expires_at", now).select("muter_id").limit(limit),
    db.from("privacy_settings").select("user_id").lt("boundary_until", now).limit(limit),
  ]);
  let boundaries = 0;
  for (const r of (due.data ?? []) as Row[]) if ((await endBoundary(r.user_id as string)).ok) boundaries++;
  return { blocks: b.error ? 0 : (b.data ?? []).length, mutes: m.error ? 0 : (m.data ?? []).length, boundaries };
}
