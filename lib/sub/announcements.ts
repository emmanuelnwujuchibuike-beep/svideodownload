import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { enqueueFanout, fanoutStatuses, type FanoutStatus } from "./fanout";
import { decodeSubCursor, encodeSubCursor, isUuid } from "./guards";
import { hasActiveSub } from "./server";

/**
 * Subscriber announcements (Frenz Exclusive Part 6) — on the existing creator_notes table (0227)
 * with 0251's audience 'subscribers', a short title and an idempotency key. Not a newsletter: a
 * title, a plain-text body, a time, and one audience.
 *
 *  · Writes take the creator from the session — there is no creator id in the request, so no one
 *    can post to (or delete) another creator's announcements.
 *  · Reads: the creator sees their own; anyone else must pass `hasActiveSub` for that creator
 *    RIGHT NOW (active, paid up, no block either way). Expired, refunded, removed and blocked
 *    members get nothing — the same empty answer as a non-subscriber, so nothing is learned.
 *    There is no read-by-id: guessing an id gets nobody anything.
 *  · A retried publish with the same key returns the same announcement and starts no second
 *    fan-out (unique (creator_id, idempotency_key) + one job per announcement).
 *  · Deleting keeps the row (deleted_at) so what was sent stays auditable, and stops any fan-out
 *    still running.
 *  · The fan-out (lib/sub/fanout.ts) decides recipients on the server, in bounded pages.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number; reason?: string };
const fail = (error: string, status = 400, reason?: string): Fail => ({ ok: false, error, status, reason });
export const ANNOUNCEMENTS_PAGE = 10;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const PENDING = (m: string) => /column|schema cache|check constraint|does not exist/i.test(m);

export interface Announcement {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  /** the creator only: what the fan-out did so far, honestly named */
  delivery?: FanoutStatus | null;
}

function clean(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (v.length < min || v.length > max || /[<>]/.test(v)) return null;
  return v;
}

/** Publish to the creator's subscribers. Returns the announcement and the fan-out job to start. */
export async function createAnnouncement(creatorId: string, input: { title?: unknown; body?: unknown; idempotencyKey?: unknown }): Promise<({ ok: true; announcement: Announcement; jobId: string | null; duplicate: boolean }) | Fail> {
  if (!isUuid(creatorId)) return fail("Invalid request.");
  const title = clean(input.title, 1, 80);
  const body = clean(input.body, 1, 2000);
  if (!title) return fail("Give it a title of up to 80 characters (plain text).");
  if (!body) return fail("Write a message of up to 2,000 characters (plain text).");
  if (typeof input.idempotencyKey !== "string" || !KEY.test(input.idempotencyKey)) return fail("Invalid request.");
  const db = createAdminClient();
  const { data: s } = await db.from("creator_membership_settings").select("setup_completed_at").eq("creator_id", creatorId).maybeSingle();
  if (!(s as Row | null)?.setup_completed_at) return fail("Set up your Exclusive subscription first.", 409, "not_set_up");

  const ins = await db.from("creator_notes").insert({ creator_id: creatorId, title, body, audience: "subscribers", min_role: "member", idempotency_key: input.idempotencyKey }).select("id, title, body, created_at");
  let row = ((ins.data ?? []) as Row[])[0];
  let duplicate = false;
  if (ins.error) {
    if (ins.error.code !== "23505") return PENDING(ins.error.message) ? fail("Announcements arrive with the next update.", 503, "pending_migration") : fail("Couldn't publish that.", 500);
    // the same publish, retried: the same announcement, no second fan-out
    const again = await db.from("creator_notes").select("id, title, body, created_at").eq("creator_id", creatorId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    row = again.data as Row;
    duplicate = true;
    if (!row) return fail("Couldn't publish that.", 500);
  }
  const jobId = await enqueueFanout("announcement", row!.id as string, creatorId);
  return { ok: true, announcement: { id: row!.id as string, title: (row!.title as string | null) ?? null, body: row!.body as string, createdAt: row!.created_at as string }, jobId, duplicate };
}

/**
 * A creator's subscriber announcements, newest first, ANNOUNCEMENTS_PAGE at a time. `access`
 * false = this viewer may not read them (and gets no items, no count, no cursor).
 */
export async function listAnnouncements(viewerId: string | null, creatorId: string, cursor?: string | null): Promise<({ ok: true; access: boolean; items: Announcement[]; next: string | null }) | Fail> {
  if (!isUuid(creatorId) || (viewerId !== null && !isUuid(viewerId))) return fail("Invalid request.");
  const c = decodeSubCursor(cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  const isCreator = viewerId === creatorId;
  // the access decision comes first: nothing is read for someone who can't see it
  if (!isCreator && !(await hasActiveSub(viewerId, creatorId))) return { ok: true, access: false, items: [], next: null };
  let q = createAdminClient().from("creator_notes").select("id, title, body, created_at").eq("creator_id", creatorId).eq("audience", "subscribers").is("deleted_at", null);
  if (c?.id) q = q.or(`created_at.lt."${c.at}",and(created_at.eq."${c.at}",id.lt.${c.id})`);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(ANNOUNCEMENTS_PAGE + 1);
  if (error) return PENDING(error.message) ? { ok: true, access: true, items: [], next: null } : fail("Couldn't load announcements.", 503);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, ANNOUNCEMENTS_PAGE);
  const delivery = isCreator ? await fanoutStatuses("announcement", page.map((r) => r.id as string)) : null;
  const last = page[page.length - 1];
  return {
    ok: true,
    access: true,
    items: page.map((r) => ({ id: r.id as string, title: (r.title as string | null) ?? null, body: r.body as string, createdAt: r.created_at as string, ...(delivery ? { delivery: delivery.get(r.id as string) ?? null } : {}) })),
    next: rows.length > ANNOUNCEMENTS_PAGE && last ? encodeSubCursor(last.created_at as string, last.id as string) : null,
  };
}

/** The creator removes one of THEIR announcements: hidden from subscribers, kept for audit, fan-out stopped. */
export async function deleteAnnouncement(creatorId: string, id: string): Promise<({ ok: true }) | Fail> {
  if (!isUuid(creatorId) || !isUuid(id)) return fail("Invalid request.");
  const db = createAdminClient();
  const at = new Date().toISOString();
  const { data, error } = await db.from("creator_notes").update({ deleted_at: at }).eq("id", id).eq("creator_id", creatorId).eq("audience", "subscribers").is("deleted_at", null).select("id");
  if (error) return fail("Couldn't delete that.", 500);
  // someone else's id, or an already-deleted one: the same "not found"
  if (!((data ?? []) as Row[]).length) return fail("Not found.", 404);
  await db.from("sub_fanout_jobs").update({ state: "cancelled", finished_at: at, updated_at: at }).eq("kind", "announcement").eq("ref_id", id).eq("state", "pending");
  return { ok: true };
}
