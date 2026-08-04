import { cache } from "react";

import { CIRCLE_AUDIENCE_PREFIX, MAX_CIRCLES_PER_MEMBER, MAX_MEMBERS_PER_CIRCLE } from "@/lib/social/graph/circles";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads for the Social Graph overlay — circles, labels, trusted contacts and
 * relationship privacy (migration 0112).
 *
 * Every read is FAIL-CLOSED and INDEPENDENT, the same discipline as
 * `profile-backends.ts`: its own try/catch, its own empty value. With 0112
 * unapplied a member simply has no circles and no labels, which is identical
 * to a member who has not made any — so nothing breaks while the migration
 * waits.
 *
 * "Fail closed" is doing real work here, not just avoiding a 500. A failed
 * circle-membership read must resolve to NOT a member: a module gated to
 * "Family" has to disappear when we cannot prove the viewer belongs, never
 * appear because a query blipped. Every default in this file points the same
 * way — toward showing less.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

async function safe<T>(
  run: () => PromiseLike<{ data: unknown; error: unknown }>,
  map: (rows: Record<string, unknown>[]) => T,
  fallback: T,
): Promise<T> {
  if (!hasSupabase) return fallback;
  try {
    const { data, error } = await run();
    if (error) return fallback;
    return map((data ?? []) as Record<string, unknown>[]);
  } catch {
    return fallback;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/* ───────────────────────────── Circles ───────────────────────────── */

export interface CircleRow {
  id: string;
  name: string;
  color: string;
  position: number;
  memberCount: number;
}

/** A member's circles with their sizes — one query for the list, one for the counts. */
export async function listCircles(ownerId: string): Promise<CircleRow[]> {
  const circles = await safe(
    () =>
      createAdminClient()
        .from("social_circles")
        .select("id, name, color, position")
        .eq("owner_id", ownerId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(MAX_CIRCLES_PER_MEMBER),
    (rows) =>
      rows
        .map((r) => ({
          id: str(r.id) ?? "",
          name: str(r.name) ?? "Circle",
          color: str(r.color) ?? "blue",
          position: typeof r.position === "number" ? r.position : 0,
          memberCount: 0,
        }))
        .filter((c) => c.id),
    [] as CircleRow[],
  );
  if (circles.length === 0) return circles;

  // Counted in ONE query over the owner's own rows rather than a count per
  // circle — a member with 50 circles must not cost 50 round trips.
  const counts = await safe(
    () =>
      createAdminClient()
        .from("circle_members")
        .select("circle_id")
        .eq("owner_id", ownerId)
        .limit(MAX_CIRCLES_PER_MEMBER * MAX_MEMBERS_PER_CIRCLE),
    (rows) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const id = str(r.circle_id);
        if (id) map.set(id, (map.get(id) ?? 0) + 1);
      }
      return map;
    },
    new Map<string, number>(),
  );

  return circles.map((c) => ({ ...c, memberCount: counts.get(c.id) ?? 0 }));
}

/** The member ids in one circle. Empty on any failure. */
export async function circleMemberIds(ownerId: string, circleId: string): Promise<string[]> {
  return safe(
    () =>
      createAdminClient()
        .from("circle_members")
        .select("member_id")
        .eq("owner_id", ownerId)
        .eq("circle_id", circleId)
        .order("added_at", { ascending: false })
        .limit(MAX_MEMBERS_PER_CIRCLE),
    (rows) => rows.map((r) => str(r.member_id)).filter((id): id is string => !!id),
    [] as string[],
  );
}

/**
 * Which of `ownerId`'s circles contain `memberId`.
 *
 * This is the one read that crosses the owner-only RLS line, so it goes
 * through the service-role client — and it returns IDS ONLY. The viewer must
 * never learn a circle's NAME from this: knowing you are in someone's
 * "Acquaintances" is exactly the disclosure the whole table is designed to
 * prevent. Callers use it to answer a yes/no visibility question, nothing more.
 *
 * Deduped per request: a profile page asks this once for the whole layout even
 * when several modules are circle-gated.
 */
export const viewerCircleIds = cache(
  async (ownerId: string, viewerId: string | null): Promise<ReadonlySet<string>> => {
    if (!viewerId || viewerId === ownerId) return new Set<string>();
    return safe(
      () =>
        createAdminClient()
          .from("circle_members")
          .select("circle_id")
          .eq("owner_id", ownerId)
          .eq("member_id", viewerId)
          .limit(MAX_CIRCLES_PER_MEMBER),
      (rows) => new Set(rows.map((r) => str(r.circle_id)).filter((id): id is string => !!id)),
      new Set<string>(),
    );
  },
);

/** Circle ids the owner may gate a module to — used to validate an audience. */
export async function ownedCircleIds(ownerId: string): Promise<Set<string>> {
  return safe(
    () =>
      createAdminClient().from("social_circles").select("id").eq("owner_id", ownerId).limit(MAX_CIRCLES_PER_MEMBER),
    (rows) => new Set(rows.map((r) => str(r.id)).filter((id): id is string => !!id)),
    new Set<string>(),
  );
}

/* ───────────────────────────── Labels ───────────────────────────── */

export interface LabelRow {
  subjectId: string;
  label: string;
  note: string | null;
}

/** Every label this member has applied, keyed by subject. */
export async function listLabels(ownerId: string): Promise<Map<string, LabelRow>> {
  return safe(
    () =>
      createAdminClient()
        .from("relationship_labels")
        .select("subject_id, label, note")
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false })
        .limit(2000),
    (rows) => {
      const map = new Map<string, LabelRow>();
      for (const r of rows) {
        const subjectId = str(r.subject_id);
        const label = str(r.label);
        if (subjectId && label) map.set(subjectId, { subjectId, label, note: str(r.note) });
      }
      return map;
    },
    new Map<string, LabelRow>(),
  );
}

export async function getLabel(ownerId: string, subjectId: string): Promise<LabelRow | null> {
  return safe(
    () =>
      createAdminClient()
        .from("relationship_labels")
        .select("subject_id, label, note")
        .eq("owner_id", ownerId)
        .eq("subject_id", subjectId)
        .limit(1),
    (rows) => {
      const r = rows[0];
      if (!r) return null;
      const label = str(r.label);
      return label ? { subjectId, label, note: str(r.note) } : null;
    },
    null as LabelRow | null,
  );
}

/* ──────────────────────── Trusted contacts ──────────────────────── */

export interface TrustedContactRow {
  id: string;
  contactId: string;
  capability: string;
  note: string | null;
}

export async function listTrustedContacts(ownerId: string): Promise<TrustedContactRow[]> {
  return safe(
    () =>
      createAdminClient()
        .from("trusted_contacts")
        .select("id, contact_id, capability, note")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true })
        .limit(20),
    (rows) =>
      rows
        .map((r) => ({
          id: str(r.id) ?? "",
          contactId: str(r.contact_id) ?? "",
          capability: str(r.capability) ?? "",
          note: str(r.note),
        }))
        .filter((c) => c.id && c.contactId && c.capability),
    [] as TrustedContactRow[],
  );
}

/* ──────────────────── Relationship privacy ──────────────────── */

export interface RelationshipPrivacy {
  friendsVisibility: "public" | "friends" | "private";
  followingVisibility: "public" | "followers" | "private";
  followersVisibility: "public" | "followers" | "private";
  showMutualConnections: boolean;
}

/**
 * The defaults, which are also the answer when the read fails or 0112 is
 * unapplied. `friends` for the friend list rather than `public` — the strict
 * direction, so a blip never publishes a friend list that was meant to be
 * closed.
 */
export const DEFAULT_RELATIONSHIP_PRIVACY: RelationshipPrivacy = {
  friendsVisibility: "friends",
  followingVisibility: "public",
  followersVisibility: "public",
  showMutualConnections: true,
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export const relationshipPrivacy = cache(async (userId: string | null): Promise<RelationshipPrivacy> => {
  if (!userId) return DEFAULT_RELATIONSHIP_PRIVACY;
  return safe(
    () =>
      createAdminClient()
        .from("privacy_settings")
        .select("friends_visibility, following_visibility, followers_visibility, show_mutual_connections")
        .eq("user_id", userId)
        .limit(1),
    (rows) => {
      const r = rows[0];
      if (!r) return DEFAULT_RELATIONSHIP_PRIVACY;
      return {
        friendsVisibility: oneOf(r.friends_visibility, ["public", "friends", "private"] as const, "friends"),
        followingVisibility: oneOf(r.following_visibility, ["public", "followers", "private"] as const, "public"),
        followersVisibility: oneOf(r.followers_visibility, ["public", "followers", "private"] as const, "public"),
        showMutualConnections: r.show_mutual_connections !== false,
      };
    },
    DEFAULT_RELATIONSHIP_PRIVACY,
  );
});

/**
 * Which of a set of accounts allow being counted as a mutual connection.
 *
 * One query for the whole candidate set — the alternative is a per-candidate
 * privacy read on a suggestions grid, which is the shape that turns a cheap
 * page into a slow one. Anyone missing a row keeps the default (true).
 */
export async function mutualDisclosureAllowed(userIds: readonly string[]): Promise<ReadonlySet<string>> {
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return new Set<string>();
  const denied = await safe(
    () =>
      createAdminClient()
        .from("privacy_settings")
        .select("user_id, show_mutual_connections")
        .in("user_id", ids)
        .eq("show_mutual_connections", false),
    (rows) => new Set(rows.map((r) => str(r.user_id)).filter((id): id is string => !!id)),
    // A failed read denies nobody — this governs an aggregate count that names
    // no one, and defaulting it closed would silently strip every suggestion
    // reason on any DB hiccup.
    new Set<string>(),
  );
  return new Set(ids.filter((id) => !denied.has(id)));
}

/** True when `viewerRelation` may browse `ownerId`'s friend list. */
export function canSeeFriendList(
  privacy: RelationshipPrivacy,
  relation: "self" | "friend" | "follower" | "stranger",
): boolean {
  if (relation === "self") return true;
  switch (privacy.friendsVisibility) {
    case "public":
      return true;
    case "friends":
      return relation === "friend";
    default:
      return false;
  }
}

/** The stored audience string for a circle-gated profile module. */
export function audienceForCircle(circleId: string): string {
  return `${CIRCLE_AUDIENCE_PREFIX}${circleId}`;
}
