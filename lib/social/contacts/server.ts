import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contact Discovery (Feature 19 · Part 5), server side. Every call runs with
 * the MEMBER's own session: the database functions read `auth.uid()`, so a
 * caller can only ever match, read or clear their own contacts.
 */

export type FindableByEmail = "everyone" | "friends_of_friends" | "nobody";
export const FINDABLE_OPTIONS: readonly { key: FindableByEmail; label: string; hint: string }[] = [
  { key: "everyone", label: "Anyone who has my e-mail", hint: "People with your address in their contacts can find you." },
  { key: "friends_of_friends", label: "Friends of friends", hint: "Only people you share a friend with." },
  { key: "nobody", label: "Nobody", hint: "No one can find you from their contacts." },
];
export function isFindable(v: unknown): v is FindableByEmail {
  return v === "everyone" || v === "friends_of_friends" || v === "nobody";
}

export interface ContactPerson {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
  isFollowing: boolean;
}

export type MatchOutcome =
  | { ok: true; matches: { h: string; person: ContactPerson }[]; remaining: number | null }
  | { ok: false; reason: "auth" | "too_many" | "invalid" | "daily_limit" | "not_ready" | "error" };

/** Before migration 0220 runs the function does not exist: say so plainly rather than "no matches". */
function missing(message: string | undefined): boolean {
  return !!message && /match_contact_hashes|my_contact_matches|findable_by_email|function|schema cache|does not exist/i.test(message);
}

async function people(sb: SupabaseClient, viewer: string, ids: string[]): Promise<Map<string, ContactPerson>> {
  if (!ids.length) return new Map();
  const [{ data: rows }, { data: follows }] = await Promise.all([
    sb.from("profiles").select("id, handle, display_name, avatar_url, is_verified, followers_count").in("id", ids),
    sb.from("follows").select("following_id").eq("follower_id", viewer).in("following_id", ids),
  ]);
  const following = new Set(((follows ?? []) as { following_id: string }[]).map((f) => f.following_id));
  const out = new Map<string, ContactPerson>();
  for (const r of (rows ?? []) as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_verified: boolean | null; followers_count: number | null }[]) {
    if (!r.handle) continue; // an account with no public profile yet is not shown
    out.set(r.id, {
      id: r.id,
      handle: r.handle,
      displayName: r.display_name || `@${r.handle}`,
      avatarUrl: r.avatar_url,
      isVerified: !!r.is_verified,
      followersCount: r.followers_count ?? 0,
      isFollowing: following.has(r.id),
    });
  }
  return out;
}

export async function matchContacts(sb: SupabaseClient, viewer: string, hashes: string[], remember: boolean): Promise<MatchOutcome> {
  const { data, error } = await sb.rpc("match_contact_hashes", { p_hashes: hashes, p_remember: remember });
  if (error) return { ok: false, reason: missing(error.message) ? "not_ready" : "error" };
  const d = data as { ok: boolean; reason?: string; matches?: { h: string; id: string }[]; remaining?: number | null };
  if (!d?.ok) return { ok: false, reason: (d?.reason as "auth" | "too_many" | "invalid" | "daily_limit") ?? "error" };
  const found = d.matches ?? [];
  const byId = await people(sb, viewer, [...new Set(found.map((m) => m.id))]);
  return {
    ok: true,
    matches: found.flatMap((m) => {
      const person = byId.get(m.id);
      return person ? [{ h: m.h, person }] : [];
    }),
    remaining: d.remaining ?? null,
  };
}

/** The matches the member chose to remember, re-filtered by everyone's CURRENT privacy setting. */
export async function savedMatches(sb: SupabaseClient, viewer: string): Promise<ContactPerson[] | null> {
  const { data, error } = await sb.rpc("my_contact_matches");
  if (error) return missing(error.message) ? null : [];
  const ids = ((data ?? []) as (string | { my_contact_matches: string })[]).map((r) => (typeof r === "string" ? r : r.my_contact_matches));
  const byId = await people(sb, viewer, ids);
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** "Delete synced contacts": every remembered match, gone. */
export async function clearMatches(sb: SupabaseClient, viewer: string): Promise<boolean> {
  const { error } = await sb.from("contact_matches").delete().eq("owner_id", viewer);
  return !error || missing(error.message);
}

export async function getFindable(sb: SupabaseClient, viewer: string): Promise<FindableByEmail | null> {
  const { data, error } = await sb.from("profile_discovery").select("findable_by_email").eq("user_id", viewer).maybeSingle();
  if (error) return missing(error.message) ? null : "everyone";
  const v = (data as { findable_by_email?: string } | null)?.findable_by_email;
  return isFindable(v) ? v : "everyone";
}

export async function setFindable(sb: SupabaseClient, viewer: string, value: FindableByEmail): Promise<boolean> {
  const { error } = await sb.from("profile_discovery").upsert({ user_id: viewer, findable_by_email: value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return !error;
}
