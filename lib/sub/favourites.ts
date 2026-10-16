import "server-only";

import { MAX_MEMBERS_PER_CIRCLE } from "@/lib/social/graph/circles";
import { createAdminClient } from "@/lib/supabase/admin";

import { decodeSubCursor, encodeSubCursor, isUuid } from "./guards";
import { subConfig } from "./server";

/**
 * Favourite creators (Frenz Exclusive Part 6) — stored as an ordinary Social Circle of kind
 * 'favourite_creators' (0251; one per member by 0217's unique index on (owner_id, kind)).
 *
 * Why a circle is safe here: every circle permission in this codebase names ONE exact circle the
 * owner picked (profile modules `circle:<uuid>`, a memory's circle, a presence audience), and no
 * rule means "anyone in any of my circles". So putting a creator in this circle grants that creator
 * nothing — unless the member later chooses this circle as an audience themselves. The member is
 * never told which circles they are in (0112), so a creator never learns who favourited them.
 *
 * Favourites are bookmarks, nothing more: adding one never grants subscription access (access is
 * `hasActiveSub`, which never reads circles), removing one never cancels a subscription, and
 * cancelling a subscription never removes a favourite.
 *
 * Every function takes the session user's id from the route; the circle is found by
 * (owner_id = that user, kind), so nobody can touch another member's favourites.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string; status: number; reason?: string };
const fail = (error: string, status = 400, reason?: string): Fail => ({ ok: false, error, status, reason });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export const FAVOURITES_KIND = "favourite_creators";
export const FAVOURITES_NAME = "Favourite creators";
export const MAX_FAVOURITES = MAX_MEMBERS_PER_CIRCLE;
export const FAVOURITES_PAGE = 24;

const PENDING = (m: string) => /check constraint|social_circles_kind_chk|column|schema cache/i.test(m);

/** The member's favourites circle id; created on first use when `create`. */
async function favouritesCircle(ownerId: string, create: boolean): Promise<{ id: string | null; error?: Fail }> {
  const db = createAdminClient();
  const read = () => db.from("social_circles").select("id").eq("owner_id", ownerId).eq("kind", FAVOURITES_KIND).limit(1);
  const found = await read();
  if (found.error) return { id: null, error: PENDING(found.error.message) ? fail("Favourites arrive with the next update.", 503, "pending_migration") : fail("Couldn't load your favourites.", 503) };
  const id = ((found.data ?? []) as Row[])[0]?.id as string | undefined;
  if (id || !create) return { id: id ?? null };
  // a member may already have a custom circle called "Favourite creators": the name is unique per owner
  for (const name of [FAVOURITES_NAME, "Favourite creators ★", "My favourite creators"]) {
    const ins = await db.from("social_circles").insert({ owner_id: ownerId, name, kind: FAVOURITES_KIND, icon: "star", color: "amber", position: 999 }).select("id");
    if (!ins.error) return { id: ((ins.data ?? []) as Row[])[0]?.id as string };
    if (ins.error.code !== "23505") return { id: null, error: PENDING(ins.error.message) ? fail("Favourites arrive with the next update.", 503, "pending_migration") : fail("Couldn't save that.", 500) };
    // a concurrent first favourite created it already, or this name is taken: look again
    const again = await read();
    const got = ((again.data ?? []) as Row[])[0]?.id as string | undefined;
    if (got) return { id: got };
  }
  return { id: null, error: fail("Couldn't save that.", 500) };
}

async function blockedEitherWay(a: string, b: string): Promise<boolean | null> {
  const { data, error } = await createAdminClient().from("blocks").select("blocker_id").or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`).limit(1);
  return error ? null : (data ?? []).length > 0;
}

/** Add a creator. Repeating it answers `already`. Refuses yourself, a blocked pair, and an account you can't see. */
export async function addFavourite(ownerId: string, creatorId: string): Promise<({ ok: true; already: boolean }) | Fail> {
  if (!isUuid(ownerId) || !isUuid(creatorId)) return fail("Invalid request.");
  // the circles model never puts the owner in their own circle
  if (ownerId === creatorId) return fail("You can't favourite yourself.", 400, "self");
  const db = createAdminClient();
  const [creatorR, blocked] = await Promise.all([db.from("profiles").select("id, is_suspended, is_hidden").eq("id", creatorId).maybeSingle(), blockedEitherWay(ownerId, creatorId)]);
  const c = creatorR.data as Row | null;
  // a block either way, a suspended or hidden account, or a missing one: the same answer (no account state is revealed)
  if (blocked !== false || !c || c.is_suspended || c.is_hidden) return fail("You can't favourite this account.", 404, "unavailable");
  const circle = await favouritesCircle(ownerId, true);
  if (circle.error || !circle.id) return circle.error ?? fail("Couldn't save that.", 500);
  const existing = await db.from("circle_members").select("member_id").eq("circle_id", circle.id).eq("member_id", creatorId).maybeSingle();
  if (existing.data) return { ok: true, already: true };
  const count = await db.from("circle_members").select("member_id", { count: "exact", head: true }).eq("circle_id", circle.id);
  if ((count.count ?? 0) >= MAX_FAVOURITES) return fail(`You can favourite up to ${MAX_FAVOURITES} creators. Remove one first.`, 409, "full");
  // owner_id is stamped from the circle by the 0112 trigger as well; sent here for the same value
  const ins = await db.from("circle_members").upsert({ circle_id: circle.id, member_id: creatorId, owner_id: ownerId }, { onConflict: "circle_id,member_id", ignoreDuplicates: true }).select("member_id");
  if (ins.error) return fail("Couldn't save that.", 500);
  return { ok: true, already: !((ins.data ?? []) as Row[]).length };
}

/** Remove a creator. Repeating it is harmless. It never touches a subscription. */
export async function removeFavourite(ownerId: string, creatorId: string): Promise<({ ok: true; already: boolean }) | Fail> {
  if (!isUuid(ownerId) || !isUuid(creatorId)) return fail("Invalid request.");
  const circle = await favouritesCircle(ownerId, false);
  if (circle.error) return circle.error;
  if (!circle.id) return { ok: true, already: true };
  const { data, error } = await createAdminClient().from("circle_members").delete().eq("owner_id", ownerId).eq("circle_id", circle.id).eq("member_id", creatorId).select("member_id");
  if (error) return fail("Couldn't save that.", 500);
  return { ok: true, already: !((data ?? []) as Row[]).length };
}

export async function isFavourite(ownerId: string, creatorId: string): Promise<boolean> {
  if (!isUuid(ownerId) || !isUuid(creatorId) || ownerId === creatorId) return false;
  const circle = await favouritesCircle(ownerId, false);
  if (!circle.id) return false;
  const { data } = await createAdminClient().from("circle_members").select("member_id").eq("circle_id", circle.id).eq("member_id", creatorId).maybeSingle();
  return !!data;
}

export interface FavouriteCreator {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  /** the creator is live for new subscribers — the same public fact their profile tab shows */
  offersSubscriptions: boolean;
  addedAt: string;
}

/**
 * The member's favourites, newest first, FAVOURITES_PAGE at a time (keyset on added_at, member_id).
 * One read for the page, then one batched read each for profiles, blocks and subscription
 * settings — never one per favourite. A suspended, hidden, deleted or blocked account is left out
 * without saying why; the member can still remove it by id.
 */
export async function listFavourites(ownerId: string, cursor?: string | null): Promise<({ ok: true; items: FavouriteCreator[]; next: string | null }) | Fail> {
  if (!isUuid(ownerId)) return fail("Invalid request.");
  const c = decodeSubCursor(cursor);
  if (c === "invalid" || (c && !c.id)) return fail("Bad cursor.");
  const circle = await favouritesCircle(ownerId, false);
  if (circle.error) return circle.error;
  if (!circle.id) return { ok: true, items: [], next: null };
  const db = createAdminClient();
  let q = db.from("circle_members").select("member_id, added_at").eq("circle_id", circle.id).eq("owner_id", ownerId);
  if (c?.id) q = q.or(`added_at.lt."${c.at}",and(added_at.eq."${c.at}",member_id.lt.${c.id})`);
  const { data, error } = await q.order("added_at", { ascending: false }).order("member_id", { ascending: false }).limit(FAVOURITES_PAGE + 1);
  if (error) return fail("Couldn't load your favourites.", 503);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, FAVOURITES_PAGE);
  const ids = page.map((r) => r.member_id as string);
  if (!ids.length) return { ok: true, items: [], next: null };
  const [cfg, profR, setR, b1, b2] = await Promise.all([
    subConfig(),
    db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", ids),
    db.from("creator_membership_settings").select("creator_id, sub_active, sub_price_cents").in("creator_id", ids),
    db.from("blocks").select("blocked_id").eq("blocker_id", ownerId).in("blocked_id", ids),
    db.from("blocks").select("blocker_id").eq("blocked_id", ownerId).in("blocker_id", ids),
  ]);
  if (profR.error || b1.error || b2.error) return fail("Couldn't load your favourites.", 503);
  const prof = new Map(((profR.data ?? []) as Row[]).map((p) => [p.id as string, p]));
  const sets = new Map(((setR.data ?? []) as Row[]).map((s) => [s.creator_id as string, s]));
  const blocked = new Set([...((b1.data ?? []) as Row[]).map((r) => r.blocked_id as string), ...((b2.data ?? []) as Row[]).map((r) => r.blocker_id as string)]);
  const items: FavouriteCreator[] = [];
  for (const r of page) {
    const p = prof.get(r.member_id as string);
    if (!p || !p.handle || p.is_suspended || p.is_hidden || blocked.has(p.id as string)) continue;
    const s = sets.get(p.id as string);
    items.push({
      id: p.id as string,
      handle: p.handle as string,
      displayName: str(p.display_name) ?? `@${p.handle as string}`,
      avatarUrl: str(p.avatar_url),
      verified: !!p.is_verified,
      offersSubscriptions: cfg.purchasesEnabled && !!s?.sub_active && Number(s?.sub_price_cents ?? 0) > 0,
      addedAt: r.added_at as string,
    });
  }
  const last = page[page.length - 1];
  return { ok: true, items, next: rows.length > FAVOURITES_PAGE && last ? encodeSubCursor(last.added_at as string, last.member_id as string) : null };
}
