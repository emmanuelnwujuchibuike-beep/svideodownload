import "server-only";

import { emit } from "@/lib/platform/event-bus";
import { isPresenceStatus, schedulesFor, toPresenceRow, toSchedule } from "@/lib/social/presence-status";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  AUTO_REPLY_MAX,
  CUSTOM_STATUS_MAX,
  effectivePresence,
  isFocusMode,
  OPEN_TO,
  SCHEDULES_MAX,
  STATUS_AUDIENCES,
  type EffectivePresence,
  type PresenceRow,
  type PresenceSchedule,
} from "./engine";

/**
 * Universal Presence™ — the member's OWN presence (Feature 19 · Part 9).
 *
 * Reading someone ELSE's presence goes through `getDisplayedStatuses`
 * (lib/social/presence-status.ts), the one privacy transform. This file is
 * only ever about the signed-in member themselves: loading their settings
 * page, saving a change, their automations and private history, and the one
 * question the notification pipeline asks ("should pushes wait right now?").
 */

export interface PresenceHistoryItem {
  kind: "status" | "focus" | "custom";
  value: string | null;
  at: string;
}

export interface OwnPresence {
  row: PresenceRow & { audienceCircle: string | null };
  effective: EffectivePresence;
  schedules: PresenceSchedule[];
  history: PresenceHistoryItem[];
  circles: { id: string; name: string }[];
  /** last_seen_visibility (0060), shown beside the status audience because the two are different questions */
  lastSeen: "everyone" | "friends" | "nobody";
  /** false until 0224 has run: the page says so instead of failing to save */
  ready: boolean;
}

const BLANK_ROW: PresenceRow = { status: "available", customText: null, customUntil: null, focusMode: null, focusUntil: null, autoReply: null, openTo: [], audience: "everyone" };

export async function getOwnPresence(userId: string, now = new Date()): Promise<OwnPresence> {
  const db = createAdminClient();
  const [full, sched, hist, circles, priv] = await Promise.all([
    db.from("user_presence_status").select("user_id, status, updated_at, custom_text, custom_until, focus_mode, focus_until, auto_reply, open_to, audience, audience_circle").eq("user_id", userId).maybeSingle(),
    db.from("presence_schedules").select("id, owner_id, mode, days, start_min, end_min, tz, enabled").eq("owner_id", userId).order("created_at"),
    db.from("presence_history").select("kind, value, at").eq("owner_id", userId).order("at", { ascending: false }).limit(40),
    db.from("social_circles").select("id, name").eq("owner_id", userId).order("position").limit(50),
    db.from("privacy_settings").select("last_seen_visibility").eq("user_id", userId).maybeSingle(),
  ]);
  const ready = !full.error && !sched.error;
  let row: PresenceRow & { audienceCircle: string | null } = { ...BLANK_ROW, audienceCircle: null };
  if (!full.error && full.data) {
    const r = full.data as Parameters<typeof toPresenceRow>[0];
    row = { ...toPresenceRow(r), audienceCircle: r.audience_circle ?? null };
  } else if (full.error) {
    // before 0224: the plain status still works
    const base = await db.from("user_presence_status").select("status").eq("user_id", userId).maybeSingle();
    const s = (base.data as { status?: string } | null)?.status;
    if (s && isPresenceStatus(s)) row = { ...row, status: s };
  }
  const schedules = sched.error ? [] : ((sched.data ?? []) as Parameters<typeof toSchedule>[0][]).map(toSchedule).filter((s): s is PresenceSchedule => !!s);
  const ls = (priv.data as { last_seen_visibility?: string } | null)?.last_seen_visibility;
  return {
    row,
    effective: effectivePresence(row, schedules, now),
    schedules,
    history: hist.error ? [] : ((hist.data ?? []) as PresenceHistoryItem[]),
    circles: circles.error ? [] : ((circles.data ?? []) as { id: string; name: string }[]),
    lastSeen: ls === "friends" || ls === "nobody" ? ls : "everyone",
    ready,
  };
}

/** Should pushes wait right now? Do Not Disturb, or a focus mode (chosen or scheduled) that holds them. Fails open to the old DND-only rule. */
export async function presenceHoldsPush(userId: string, now = new Date()): Promise<boolean> {
  const db = createAdminClient();
  const full = await db.from("user_presence_status").select("user_id, status, updated_at, custom_text, custom_until, focus_mode, focus_until, auto_reply, open_to, audience").eq("user_id", userId).maybeSingle();
  if (full.error) {
    const base = await db.from("user_presence_status").select("status").eq("user_id", userId).maybeSingle();
    return (base.data as { status?: string } | null)?.status === "dnd";
  }
  const row = full.data ? toPresenceRow(full.data as Parameters<typeof toPresenceRow>[0]) : BLANK_ROW;
  const schedules = (await schedulesFor(db, [userId])).get(userId) ?? [];
  return effectivePresence(row, schedules, now).holdsPush;
}

// ─── Saving ─────────────────────────────────────────────────────────────────

export interface PresencePatch {
  /** validated here - the API passes what it was sent */
  status?: string;
  customText?: string | null;
  customUntil?: string | null;
  focusMode?: string | null;
  focusUntil?: string | null;
  autoReply?: string | null;
  openTo?: string[];
  audience?: string;
  audienceCircle?: string | null;
}

/** Trim, bound and validate. Returns the problem in words, or the columns to write. */
export function presencePatchColumns(p: PresencePatch): { ok: true; columns: Record<string, unknown> } | { ok: false; error: string } {
  const c: Record<string, unknown> = {};
  if (p.status !== undefined) {
    if (!isPresenceStatus(p.status)) return { ok: false, error: "Unknown status." };
    c.status = p.status;
  }
  if (p.customText !== undefined) {
    const t = p.customText?.replace(/\s+/g, " ").trim() || null;
    if (t && t.length > CUSTOM_STATUS_MAX) return { ok: false, error: `Keep it under ${CUSTOM_STATUS_MAX} characters.` };
    c.custom_text = t;
    if (!t) c.custom_until = null;
  }
  if (p.customUntil !== undefined && c.custom_text !== null) c.custom_until = p.customUntil;
  if (p.focusMode !== undefined) {
    if (p.focusMode !== null && !isFocusMode(p.focusMode)) return { ok: false, error: "Unknown focus mode." };
    c.focus_mode = p.focusMode;
    c.focus_until = p.focusMode ? (p.focusUntil ?? null) : null;
  }
  if (p.autoReply !== undefined) {
    const t = p.autoReply?.replace(/\s+/g, " ").trim() || null;
    if (t && t.length > AUTO_REPLY_MAX) return { ok: false, error: `Keep it under ${AUTO_REPLY_MAX} characters.` };
    c.auto_reply = t;
  }
  if (p.openTo !== undefined) {
    if (!p.openTo.every((o) => (OPEN_TO as readonly string[]).includes(o))) return { ok: false, error: "Unknown availability." };
    c.open_to = [...new Set(p.openTo)];
  }
  if (p.audience !== undefined) {
    if (!(STATUS_AUDIENCES as readonly string[]).includes(p.audience)) return { ok: false, error: "Unknown audience." };
    if (p.audience === "circle" && !p.audienceCircle) return { ok: false, error: "Choose a circle." };
    c.audience = p.audience;
    c.audience_circle = p.audience === "circle" ? p.audienceCircle : null;
  }
  for (const k of ["custom_until", "focus_until"] as const) {
    const v = c[k];
    if (typeof v === "string" && Number.isNaN(Date.parse(v))) return { ok: false, error: "That end time isn't valid." };
  }
  return { ok: true, columns: c };
}

export async function savePresence(userId: string, patch: PresencePatch): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const v = presencePatchColumns(patch);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const db = createAdminClient();
  if (v.columns.audience_circle) {
    // the circle must be the member's own
    const { data } = await db.from("social_circles").select("id").eq("id", v.columns.audience_circle as string).eq("owner_id", userId).maybeSingle();
    if (!data) return { ok: false, error: "Choose one of your circles.", status: 400 };
  }
  const { error } = await db.from("user_presence_status").upsert({ user_id: userId, ...v.columns, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    const missing = /column|schema cache|does not exist/i.test(error.message);
    return { ok: false, error: missing ? "This arrives with the next update." : "Couldn't save that.", status: missing ? 503 : 500 };
  }
  emit("presence.changed", { userId, status: (v.columns.status as string | undefined) ?? "unchanged", focusMode: (v.columns.focus_mode as string | null | undefined) ?? null });
  if (typeof v.columns.focus_mode === "string") emit("focus.enabled", { userId, focusMode: v.columns.focus_mode });
  return { ok: true };
}

// ─── Automations ────────────────────────────────────────────────────────────

export interface ScheduleInput {
  id?: string;
  mode: string;
  days: number;
  startMin: number;
  endMin: number;
  tz: string;
  enabled: boolean;
}

export function scheduleProblem(s: ScheduleInput): string | null {
  if (!isFocusMode(s.mode)) return "Unknown focus mode.";
  if (!Number.isInteger(s.days) || s.days < 1 || s.days > 127) return "Choose at least one day.";
  for (const m of [s.startMin, s.endMin]) if (!Number.isInteger(m) || m < 0 || m > 1439) return "That time isn't valid.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s.tz });
  } catch {
    return "Unknown time zone.";
  }
  return null;
}

export async function saveSchedule(userId: string, s: ScheduleInput): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const problem = scheduleProblem(s);
  if (problem) return { ok: false, error: problem, status: 400 };
  const db = createAdminClient();
  const cols = { owner_id: userId, mode: s.mode, days: s.days, start_min: s.startMin, end_min: s.endMin, tz: s.tz, enabled: s.enabled };
  if (s.id) {
    const { data, error } = await db.from("presence_schedules").update(cols).eq("id", s.id).eq("owner_id", userId).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: "Couldn't save that.", status: error ? 500 : 404 };
    return { ok: true, id: (data as { id: string }).id };
  }
  const { count } = await db.from("presence_schedules").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if ((count ?? 0) >= SCHEDULES_MAX) return { ok: false, error: `Up to ${SCHEDULES_MAX} automations.`, status: 400 };
  const { data, error } = await db.from("presence_schedules").insert(cols).select("id").single();
  if (error) {
    const missing = /presence_schedules|schema cache|does not exist/i.test(error.message);
    return { ok: false, error: missing ? "Automations arrive with the next update." : "Couldn't save that.", status: missing ? 503 : 500 };
  }
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteSchedule(userId: string, id: string): Promise<boolean> {
  const { error } = await createAdminClient().from("presence_schedules").delete().eq("id", id).eq("owner_id", userId);
  return !error;
}
