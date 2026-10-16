import "server-only";

import { presignPrivateGet, hasPrivateR2 } from "@/lib/storage/r2";
import { writeAuditLog } from "@/lib/security/audit-log";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { createAdminClient } from "@/lib/supabase/admin";

import { isUuid } from "./guards";
import { hasActiveSub } from "./server";

/**
 * Reporting and moderation of EXCLUSIVE content (Frenz Exclusive Part 2, 2026-10-16).
 *
 * Exclusive posts and their comments ride the existing `reports` queue (0247 widens
 * `reports_target_chk` with `sub_post` / `sub_comment`) and the existing admin queue
 * (`lib/social/moderation.ts` delegates here). What is different, deliberately:
 *
 *  · Filing a report reveals NOTHING. The reporter is told "reported", never a caption,
 *    a storage key or a link. A non-subscriber may report what they can see (the post's
 *    public tile); only someone who can read a comment (an active subscriber or the
 *    creator) may report it.
 *  · No auto-hide. Public posts hide at 3 reports (0010). Paid content is not: anyone can
 *    see the locked tile, so three strangers could switch off a creator's income. An admin
 *    decides every exclusive report.
 *  · A takedown ARCHIVES the post (`sub_posts.status = 'archived'`): it leaves the gallery
 *    and every access path at once (all of them require 'published'), its media stays in
 *    private storage as evidence, and the creator cannot delete it while archived. A
 *    comment takedown sets `hidden_at`; nothing is deleted.
 *  · An admin who must SEE the content gets five-minute presigned links minted here, after
 *    the admin check in the route, and every review is written to the security audit log.
 *    There is no URL for the content outside this call.
 */

type Row = Record<string, unknown>;
export type SubTargetType = "sub_post" | "sub_comment";
export const SUB_TARGET_TYPES: readonly SubTargetType[] = ["sub_post", "sub_comment"];
export const isSubTargetType = (t: unknown): t is SubTargetType => t === "sub_post" || t === "sub_comment";

type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const REVIEW_TTL_SECONDS = 300;

async function blockedBetween(a: string, b: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("blocks").select("blocker_id").or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`).limit(1);
  return !error && (data ?? []).length > 0;
}

/** Who may report this target? Answers the target's owner (for the audit trail) or a refusal. */
export async function canReportSubTarget(reporterId: string, type: SubTargetType, targetId: string): Promise<{ ok: true; ownerId: string } | Fail> {
  if (!isUuid(reporterId) || !isUuid(targetId) || !isSubTargetType(type)) return fail("Invalid report.");
  const db = createAdminClient();
  if (type === "sub_post") {
    const { data } = await db.from("sub_posts").select("creator_id, status").eq("id", targetId).maybeSingle();
    const p = data as Row | null;
    if (!p || p.status !== "published") return fail("This post isn't available.", 404);
    const creatorId = p.creator_id as string;
    if (creatorId === reporterId) return fail("You can't report your own post.");
    // the tile is visible on the creator's profile to anyone who can see that profile
    const { data: prof } = await db.from("profiles").select("is_suspended, is_hidden").eq("id", creatorId).maybeSingle();
    if (!prof || !isAccountVisibleTo(flagsOf(prof as Row), "stranger") || (await blockedBetween(reporterId, creatorId))) return fail("This post isn't available.", 404);
    return { ok: true, ownerId: creatorId };
  }
  const { data } = await db.from("sub_post_comments").select("user_id, post_id, hidden_at, sub_posts!inner(creator_id, status)").eq("id", targetId).maybeSingle();
  const c = data as (Row & { sub_posts?: Row | Row[] }) | null;
  const post = Array.isArray(c?.sub_posts) ? c?.sub_posts[0] : c?.sub_posts;
  if (!c || c.hidden_at || !post || post.status !== "published") return fail("This comment isn't available.", 404);
  if (c.user_id === reporterId) return fail("You can't report your own comment.");
  // only someone who can READ the comment may report it
  if (!(await hasActiveSub(reporterId, post.creator_id as string))) return fail("This comment isn't available.", 404);
  return { ok: true, ownerId: c.user_id as string };
}

/** Files the report. A repeat by the same person is accepted quietly (one row per reporter and target). */
export async function reportSubTarget(reporterId: string, type: SubTargetType, targetId: string, reason: string, note: string | null): Promise<{ ok: true } | Fail> {
  const can = await canReportSubTarget(reporterId, type, targetId);
  if (!can.ok) return can;
  const { error } = await createAdminClient().from("reports").insert({ reporter_id: reporterId, target_type: type, target_id: targetId, reason, note });
  if (error && error.code !== "23505") return /check constraint|reports_target_chk/i.test(error.message) ? fail("Reporting exclusive content arrives with the next update.", 503) : fail("Couldn't submit report.", 500);
  return { ok: true };
}

/** Queue rows for exclusive targets: what an admin needs to triage, never a media link. */
export async function subTargetDetails(ids: { posts: string[]; comments: string[] }): Promise<Map<string, { title: string; status: string; handle: string | null; ownerId: string | null }>> {
  const out = new Map<string, { title: string; status: string; handle: string | null; ownerId: string | null }>();
  const db = createAdminClient();
  const [posts, comments] = await Promise.all([
    ids.posts.length ? db.from("sub_posts").select("id, creator_id, caption, status").in("id", ids.posts) : Promise.resolve({ data: [] }),
    ids.comments.length ? db.from("sub_post_comments").select("id, user_id, body, hidden_at").in("id", ids.comments) : Promise.resolve({ data: [] }),
  ]);
  const people = [...((posts.data ?? []) as Row[]).map((p) => p.creator_id as string), ...((comments.data ?? []) as Row[]).map((c) => c.user_id as string)];
  const { data: profs } = people.length ? await db.from("profiles").select("id, handle").in("id", people) : { data: [] };
  const handle = new Map(((profs ?? []) as Row[]).map((p) => [p.id as string, (p.handle as string | null) ?? null]));
  for (const p of (posts.data ?? []) as Row[]) {
    const caption = (p.caption as string | null)?.trim();
    out.set(`sub_post:${p.id as string}`, { title: caption ? `Exclusive post · “${caption.slice(0, 70)}”` : "Exclusive post", status: p.status as string, handle: handle.get(p.creator_id as string) ?? null, ownerId: p.creator_id as string });
  }
  for (const c of (comments.data ?? []) as Row[]) {
    out.set(`sub_comment:${c.id as string}`, { title: `“${((c.body as string) ?? "").slice(0, 80)}”`, status: c.hidden_at ? "hidden" : "visible", handle: handle.get(c.user_id as string) ?? null, ownerId: c.user_id as string });
  }
  return out;
}

export type SubModAction = "remove" | "restore" | "dismiss";
export const isSubModAction = (a: unknown): a is SubModAction => a === "remove" || a === "restore" || a === "dismiss";

/**
 * Applies an admin decision. The ROUTE has already checked the admin; this re-checks nothing
 * about the caller and must never be reachable without that check. Returns the owner for the
 * audit trail written by the caller.
 */
export async function moderateSubTarget(type: SubTargetType, targetId: string, action: SubModAction, adminId: string): Promise<{ ok: true; ownerId: string | null } | Fail> {
  if (!isUuid(targetId) || !isSubTargetType(type) || !isSubModAction(action)) return fail("Invalid action.");
  const db = createAdminClient();
  const at = new Date().toISOString();
  if (type === "sub_post") {
    const { data } = await db.from("sub_posts").select("creator_id, status").eq("id", targetId).maybeSingle();
    const p = data as Row | null;
    if (!p) return fail("Not found.", 404);
    if (action === "remove") {
      const { error } = await db.from("sub_posts").update({ status: "archived", moderated_at: at, moderated_by: adminId, updated_at: at }).eq("id", targetId);
      if (error) return fail("Action failed.", 500);
    } else if (action === "restore") {
      const { error } = await db.from("sub_posts").update({ status: "published", moderated_at: null, moderated_by: null, updated_at: at }).eq("id", targetId).eq("status", "archived");
      if (error) return fail("Action failed.", 500);
    }
    return { ok: true, ownerId: p.creator_id as string };
  }
  const { data } = await db.from("sub_post_comments").select("user_id").eq("id", targetId).maybeSingle();
  const c = data as Row | null;
  if (!c) return fail("Not found.", 404);
  if (action !== "dismiss") {
    const { error } = await db.from("sub_post_comments").update(action === "remove" ? { hidden_at: at, hidden_by: adminId } : { hidden_at: null, hidden_by: null }).eq("id", targetId);
    if (error) return fail("Action failed.", 500);
  }
  return { ok: true, ownerId: c.user_id as string };
}

export interface SubReview {
  type: SubTargetType;
  status: string;
  caption: string | null;
  comment: string | null;
  creatorHandle: string | null;
  media: { kind: "image" | "video"; url: string }[];
  expiresAt: string;
  reports: { reason: string; note: string | null; status: string; createdAt: string }[];
}

/**
 * What an ADMIN sees when reviewing a reported exclusive post or comment: the caption, the
 * comment, the reports, and five-minute links to the media. Called only from the admin-gated
 * route. Every call is audited (who looked at whose content, and when).
 */
export async function reviewSubTarget(adminId: string, type: SubTargetType, targetId: string): Promise<({ ok: true } & SubReview) | Fail> {
  if (!isUuid(targetId) || !isSubTargetType(type)) return fail("Invalid request.");
  const db = createAdminClient();
  let postId = targetId;
  let comment: string | null = null;
  let commentStatus: string | null = null;
  if (type === "sub_comment") {
    const { data } = await db.from("sub_post_comments").select("post_id, body, hidden_at").eq("id", targetId).maybeSingle();
    const c = data as Row | null;
    if (!c) return fail("Not found.", 404);
    postId = c.post_id as string;
    comment = (c.body as string) ?? null;
    commentStatus = c.hidden_at ? "hidden" : "visible";
  }
  const [{ data: post }, { data: media }, { data: reports }] = await Promise.all([
    db.from("sub_posts").select("creator_id, caption, status").eq("id", postId).maybeSingle(),
    db.from("sub_post_media").select("idx, media_kind, object_key").eq("post_id", postId).order("idx"),
    db.from("reports").select("reason, note, status, created_at").eq("target_type", type).eq("target_id", targetId).order("created_at", { ascending: false }).limit(50),
  ]);
  const p = post as Row | null;
  if (!p) return fail("Not found.", 404);
  const { data: prof } = await db.from("profiles").select("handle").eq("id", p.creator_id as string).maybeSingle();
  // the media is only needed for a POST review; a comment review shows its post's caption and the comment
  const signed =
    type === "sub_post" && hasPrivateR2
      ? await Promise.all(((media ?? []) as Row[]).map(async (m) => ({ kind: m.media_kind as "image" | "video", url: await presignPrivateGet(m.object_key as string, REVIEW_TTL_SECONDS) })))
      : [];
  await writeAuditLog({ userId: p.creator_id as string, actorUserId: adminId, eventType: "moderation_review", targetType: type, targetId, metadata: { media: signed.length, post_id: postId } });
  return {
    ok: true,
    type,
    status: commentStatus ?? (p.status as string),
    caption: (p.caption as string | null) ?? null,
    comment,
    creatorHandle: ((prof as Row | null)?.handle as string | null) ?? null,
    media: signed,
    expiresAt: new Date(Date.now() + REVIEW_TTL_SECONDS * 1000).toISOString(),
    reports: ((reports ?? []) as Row[]).map((r) => ({ reason: r.reason as string, note: (r.note as string | null) ?? null, status: r.status as string, createdAt: r.created_at as string })),
  };
}
