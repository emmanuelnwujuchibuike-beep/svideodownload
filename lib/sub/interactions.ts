import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { visibleTo } from "./guards";
import { readSubPostGate } from "./posts";
import { hasActiveSub } from "./server";

/**
 * LIKES AND COMMENTS ON PRIVATE POSTS (owner 2026-10-12: "users can interact, like and comment on
 * a private post like a public post, but only users who subscribed can like and comment — not
 * save"). Every read and write checks access first: the creator, or an active subscriber — the
 * same check that guards opening the post. There is no save action at all. Tables 0239.
 */
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const MISSING = (m: string) => /schema cache|does not exist|relation/i.test(m);

async function access(postId: string, userId: string | null): Promise<{ ok: true; creatorId: string } | Fail> {
  if (!userId) return fail("Sign in to do that.", 401);
  const gate = await readSubPostGate(postId);
  if (!gate) return fail("This post isn't available.", 404);
  if (!(await hasActiveSub(userId, gate.creatorId))) {
    // Part 3: a hidden post answers exactly like one that does not exist
    return visibleTo(gate.audience, false) ? fail("Subscribe to like and comment.", 403) : fail("This post isn't available.", 404);
  }
  return { ok: true, creatorId: gate.creatorId };
}

export interface PrivateComment {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: { name: string; handle: string | null; avatarUrl: string | null };
}

export async function interactionSummary(postId: string, userId: string | null): Promise<{ ok: true; likes: number; liked: boolean; comments: number } | Fail> {
  const a = await access(postId, userId);
  if (!a.ok) return a;
  const db = createAdminClient();
  const visibleComments = () => db.from("sub_post_comments").select("id", { count: "exact", head: true }).eq("post_id", postId);
  const [likes, mine, counted] = await Promise.all([
    db.from("sub_post_likes").select("post_id", { count: "exact", head: true }).eq("post_id", postId),
    db.from("sub_post_likes").select("post_id").eq("post_id", postId).eq("user_id", userId!).maybeSingle(),
    // a comment an admin took down (0247 hidden_at) is not counted; before 0247 every comment is
    visibleComments().is("hidden_at", null),
  ]);
  if (likes.error && MISSING(likes.error.message)) return fail("Likes and comments arrive with the next update.", 503);
  const comments = counted.error && MISSING(counted.error.message) ? await visibleComments() : counted;
  return { ok: true, likes: likes.count ?? 0, liked: !!mine.data, comments: comments.count ?? 0 };
}

export async function setLike(postId: string, userId: string | null, like: boolean): Promise<{ ok: true } | Fail> {
  const a = await access(postId, userId);
  if (!a.ok) return a;
  const db = createAdminClient();
  const { error } = like
    ? await db.from("sub_post_likes").upsert({ post_id: postId, user_id: userId! }, { onConflict: "post_id,user_id", ignoreDuplicates: true })
    : await db.from("sub_post_likes").delete().eq("post_id", postId).eq("user_id", userId!);
  if (error) return MISSING(error.message) ? fail("Likes arrive with the next update.", 503) : fail("Couldn't save that.", 500);
  return { ok: true };
}

export async function listComments(postId: string, userId: string | null): Promise<{ ok: true; comments: PrivateComment[] } | Fail> {
  const a = await access(postId, userId);
  if (!a.ok) return a;
  const db = createAdminClient();
  const read = () => db.from("sub_post_comments").select("id, user_id, body, created_at").eq("post_id", postId).order("created_at", { ascending: true }).limit(200);
  // taken-down comments (0247 hidden_at) never reach anyone; before 0247 the column is absent
  let res = await read().is("hidden_at", null);
  if (res.error && /hidden_at/.test(res.error.message)) res = await read();
  const { data, error } = res;
  if (error) return MISSING(error.message) ? fail("Comments arrive with the next update.", 503) : fail("Couldn't load comments.", 500);
  const rows = (data ?? []) as { id: string; user_id: string; body: string; created_at: string }[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: people } = ids.length ? await db.from("profiles").select("id, display_name, handle, avatar_url").in("id", ids) : { data: [] };
  const byId = new Map(((people ?? []) as { id: string; display_name: string | null; handle: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
  return {
    ok: true,
    comments: rows.map((r) => {
      const p = byId.get(r.user_id);
      return { id: r.id, body: r.body, createdAt: r.created_at, mine: r.user_id === userId, author: { name: p?.display_name || (p?.handle ? `@${p.handle}` : "Someone"), handle: p?.handle ?? null, avatarUrl: p?.avatar_url ?? null } };
    }),
  };
}

export async function addComment(postId: string, userId: string | null, body: string): Promise<{ ok: true; id: string } | Fail> {
  const text = body.trim();
  if (!text || text.length > 1000) return fail("Write 1 to 1,000 characters.");
  const a = await access(postId, userId);
  if (!a.ok) return a;
  const { data, error } = await createAdminClient().from("sub_post_comments").insert({ post_id: postId, user_id: userId!, body: text }).select("id").single();
  if (error) return MISSING(error.message) ? fail("Comments arrive with the next update.", 503) : fail("Couldn't post that.", 500);
  return { ok: true, id: (data as { id: string }).id };
}

/** The author removes their own comment, or the creator removes any comment on their post. */
export async function deleteComment(postId: string, commentId: string, userId: string | null): Promise<{ ok: true } | Fail> {
  const a = await access(postId, userId);
  if (!a.ok) return a;
  const db = createAdminClient();
  let q = db.from("sub_post_comments").delete().eq("id", commentId).eq("post_id", postId);
  if (a.creatorId !== userId) q = q.eq("user_id", userId!);
  const { error } = await q;
  return error ? fail("Couldn't delete that.", 500) : { ok: true };
}
