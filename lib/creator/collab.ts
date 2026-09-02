import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type { CollabInvite, CollabRole, CollabStatus, Collaborator } from "./collab-types";

/**
 * Collaboration (Feature 15 · Part 9) — permission-based co-creation.
 *
 * ── The permission model, in one sentence ────────────────────────────────
 * An invite is `pending` until the invitee accepts it, and ONLY an `accepted`
 * collaborator is credited on the post or may open its analytics — enforced on
 * every server read, never by hiding a button.
 *
 * ── What is not here ────────────────────────────────────────────────────
 * Revenue sharing. `post_collaborators` has no split column and that is
 * deliberate: this platform has no payout rails at all (the Creator Payout
 * Service is listed as `planned` in lib/platform/commerce-platform.ts). A
 * percentage stored against a collaborator would settle nothing, pay nobody,
 * and read to a creator as a promise the product cannot keep. When rails exist,
 * a split column is one migration; a fabricated one now would be a lie with a
 * schema.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type { CollabRole, CollabStatus, Collaborator, CollabInvite } from "./collab-types";

interface CollabRow {
  post_id: string;
  user_id: string;
  invited_by: string;
  role: string;
  status: string;
  created_at: string;
}

/** Everyone attached to a post, in either direction. Owner-only. */
export async function listCollaborators(postId: string, ownerId: string): Promise<Collaborator[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();

    const { data: post } = await db
      .from("posts")
      .select("id")
      .eq("id", postId)
      .eq("publisher_id", ownerId)
      .maybeSingle();
    if (!post) return [];

    const { data } = await db
      .from("post_collaborators")
      .select("post_id, user_id, invited_by, role, status, created_at")
      .eq("post_id", postId)
      .limit(50);

    const rows = (data ?? []) as CollabRow[];
    if (rows.length === 0) return [];

    const { data: profiles } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .in("id", rows.map((r) => r.user_id));

    const byId = new Map(
      ((profiles ?? []) as { id: string; handle: string; display_name: string | null; avatar_url: string | null }[]).map(
        (p) => [p.id, p],
      ),
    );

    return rows
      .map((r) => {
        const p = byId.get(r.user_id);
        if (!p) return null;
        return {
          userId: r.user_id,
          handle: p.handle,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
          role: (r.role as CollabRole) ?? "collaborator",
          status: (r.status as CollabStatus) ?? "pending",
          createdAt: r.created_at,
        };
      })
      .filter((c): c is Collaborator => c !== null);
  } catch {
    return [];
  }
}

/**
 * Invite someone to a post by handle.
 *
 * Checks, in order: the inviter owns the post, the handle resolves, it is not
 * the owner themselves, and neither party has blocked the other. The block
 * check is why this is a service-role write rather than an RLS-guarded client
 * insert — a row policy cannot express "and these two have not blocked each
 * other" without duplicating the whole visibility layer into SQL.
 */
export async function inviteCollaborator(
  postId: string,
  ownerId: string,
  handle: string,
  role: CollabRole = "collaborator",
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: "Unavailable." };

  const clean = handle.trim().replace(/^@/, "").slice(0, 40);
  if (!clean) return { ok: false, error: "Enter a handle." };

  try {
    const db = createAdminClient();

    const { data: post } = await db
      .from("posts")
      .select("id")
      .eq("id", postId)
      .eq("publisher_id", ownerId)
      .maybeSingle();
    if (!post) return { ok: false, error: "That post isn't yours." };

    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .ilike("handle", clean)
      .maybeSingle();
    if (!profile) return { ok: false, error: `No account called @${clean}.` };

    const inviteeId = (profile as { id: string }).id;
    if (inviteeId === ownerId) return { ok: false, error: "You're already on this post." };

    const { data: blocks } = await db
      .from("blocks")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${ownerId},blocked_id.eq.${inviteeId}),and(blocker_id.eq.${inviteeId},blocked_id.eq.${ownerId})`,
      )
      .limit(1);
    if ((blocks ?? []).length > 0) return { ok: false, error: `You can't invite @${clean}.` };

    const { error } = await db
      .from("post_collaborators")
      .upsert(
        { post_id: postId, user_id: inviteeId, invited_by: ownerId, role, status: "pending" },
        { onConflict: "post_id,user_id" },
      );
    if (error) return { ok: false, error: "Couldn't send that invite." };

    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't send that invite." };
  }
}

/** Invites addressed to this member, newest first. */
export async function listMyInvites(userId: string, status: CollabStatus = "pending"): Promise<CollabInvite[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();

    const { data } = await db
      .from("post_collaborators")
      .select("post_id, user_id, invited_by, role, status, created_at")
      .eq("user_id", userId)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = (data ?? []) as CollabRow[];
    if (rows.length === 0) return [];

    const [{ data: posts }, { data: inviters }] = await Promise.all([
      db.from("posts").select("id, title, thumbnail_url").in("id", rows.map((r) => r.post_id)),
      db.from("profiles").select("id, handle").in("id", rows.map((r) => r.invited_by)),
    ]);

    const postById = new Map(
      ((posts ?? []) as { id: string; title: string; thumbnail_url: string | null }[]).map((p) => [p.id, p]),
    );
    const inviterById = new Map(((inviters ?? []) as { id: string; handle: string }[]).map((p) => [p.id, p.handle]));

    return rows.flatMap<CollabInvite>((r) => {
      const post = postById.get(r.post_id);
      // A post deleted since the invite was sent: drop the row rather than
      // rendering an invite to something that no longer exists.
      if (!post) return [];
      return [
        {
          postId: r.post_id,
          postTitle: post.title,
          postThumbnailUrl: post.thumbnail_url,
          role: (r.role as CollabRole) ?? "collaborator",
          status: (r.status as CollabStatus) ?? "pending",
          createdAt: r.created_at,
          invitedByHandle: inviterById.get(r.invited_by) ?? null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Accept or decline an invite addressed to you. */
export async function respondToInvite(
  postId: string,
  userId: string,
  accept: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: "Unavailable." };
  try {
    const { error } = await createAdminClient()
      .from("post_collaborators")
      .update({ status: accept ? "accepted" : "declined" })
      .eq("post_id", postId)
      .eq("user_id", userId)
      .eq("status", "pending");
    if (error) return { ok: false, error: "Couldn't respond." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't respond." };
  }
}

export async function removeCollaborator(postId: string, ownerId: string, userId: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const db = createAdminClient();
    const { data: post } = await db
      .from("posts")
      .select("id")
      .eq("id", postId)
      .eq("publisher_id", ownerId)
      .maybeSingle();
    if (!post) return false;

    const { error } = await db.from("post_collaborators").delete().eq("post_id", postId).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * May this member open this post's analytics?
 *
 * True for the publisher, and for an ACCEPTED collaborator. This is the single
 * check every collaborator-facing read goes through — the reason it lives here
 * rather than being inlined at each call site is that "accepted" is the whole
 * permission model, and it must be impossible to forget the clause.
 */
export async function canViewPostInsights(postId: string, userId: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const db = createAdminClient();

    const { data: owned } = await db
      .from("posts")
      .select("id")
      .eq("id", postId)
      .eq("publisher_id", userId)
      .maybeSingle();
    if (owned) return true;

    const { data: collab } = await db
      .from("post_collaborators")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .eq("status", "accepted")
      .maybeSingle();
    return Boolean(collab);
  } catch {
    return false;
  }
}

/** Accepted collaborators on a post, for the public credit line. */
export async function acceptedCollaborators(postId: string): Promise<{ handle: string; displayName: string | null }[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("post_collaborators")
      .select("user_id")
      .eq("post_id", postId)
      .eq("status", "accepted")
      .limit(20);

    const ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (ids.length === 0) return [];

    const { data: profiles } = await db.from("profiles").select("handle, display_name").in("id", ids);
    return ((profiles ?? []) as { handle: string; display_name: string | null }[]).map((p) => ({
      handle: p.handle,
      displayName: p.display_name,
    }));
  } catch {
    return [];
  }
}
