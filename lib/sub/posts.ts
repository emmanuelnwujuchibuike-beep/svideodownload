import "server-only";

import { deletePrivate, hasPrivateR2, presignPrivateGet, presignPrivatePut } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

import { hasActiveSub, subConfig } from "./server";

/**
 * Subscriber-only posts (0227, owner briefs 2026-10-11).
 *
 * ── A store of their own ──────────────────────────────────────────────────
 * `sub_posts` / `sub_post_media` are separate from `posts`, so no feed, reel,
 * search, trending, repost, collection, sitemap, share or notification path —
 * none of which know these tables — can ever surface them. There is no public
 * page for a sub post and no share, copy-link, repost or embed action exists for
 * one: it opens only inside its creator's SUB POSTS tab.
 *
 * ── Media never leaves without an access check ────────────────────────────
 * Files live in the PRIVATE bucket (no public domain). A non-subscriber gets the
 * post's public cover (if the creator set one), its date and how many items it
 * holds — never the caption, a media key or a URL. A subscriber who opens a post
 * gets presigned links that expire in five minutes, minted AFTER `hasActiveSub`
 * says yes; an expired or revoked subscription gets nothing. Responses are
 * `no-store`, so no cache can serve one viewer's links to another.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const SIGNED_TTL_SECONDS = 300;
const MAX_MEDIA = 10;
const PAGE = 24;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);

export type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });

/** A presigned upload into the creator's own private folder. */
export async function subUploadPlan(creatorId: string, kind: string, ext: string): Promise<{ ok: true; uploadUrl: string; key: string } | Fail> {
  if (!hasPrivateR2) return fail("Private storage isn't set up yet, so subscriber-only uploads are off. Nothing was uploaded.", 503);
  const e = ext.toLowerCase().replace(/^\./, "");
  if (!((kind === "image" && IMAGE_EXT.has(e)) || (kind === "video" && VIDEO_EXT.has(e)))) return fail("That file type isn't supported.");
  const key = `sub/${creatorId}/${crypto.randomUUID()}.${e}`;
  return { ok: true, uploadUrl: await presignPrivatePut(key), key };
}

/** Only https covers on our own public media host — a cover is a public teaser, never the private file. */
function validCover(url: string | null | undefined): string | null | false {
  if (!url) return null;
  try {
    const u = new URL(url);
    const pub = process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).host : null;
    const supa = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
    return u.protocol === "https:" && (u.host === pub || u.host === supa) && url.length <= 600 ? url : false;
  } catch {
    return false;
  }
}

export async function createSubPost(creatorId: string, input: { caption?: string | null; coverUrl?: string | null; media: { key: string; kind: string; width?: number | null; height?: number | null }[] }): Promise<{ ok: true; id: string } | Fail> {
  if (!hasPrivateR2) return fail("Private storage isn't set up yet.", 503);
  const db = createAdminClient();
  const { data: s } = await db.from("creator_membership_settings").select("sub_price_cents").eq("creator_id", creatorId).maybeSingle();
  if (!(s as Row | null)?.sub_price_cents) return fail("Set your subscription price before posting for subscribers.", 409);
  const caption = input.caption?.trim() || null;
  if (caption && (caption.length > 2200 || /[<>]/.test(caption))) return fail("Keep the caption to 2,200 characters of plain text.");
  const cover = validCover(input.coverUrl);
  if (cover === false) return fail("That cover can't be used.");
  if (!input.media.length || input.media.length > MAX_MEDIA) return fail(`Add 1 to ${MAX_MEDIA} photos or videos.`);
  // a creator can only attach objects from their OWN private folder
  const prefix = `sub/${creatorId}/`;
  for (const m of input.media) {
    if (!m.key.startsWith(prefix) || m.key.includes("..") || !/^[A-Za-z0-9/._-]+$/.test(m.key) || (m.kind !== "image" && m.kind !== "video")) return fail("One of the files isn't yours to post.", 403);
  }
  const { data: post, error } = await db.from("sub_posts").insert({ creator_id: creatorId, caption, cover_url: cover }).select("id").single();
  if (error) return MISSING(error.message) ? fail("Subscriber posts arrive with the next update.", 503) : fail("Couldn't post that.", 500);
  const id = (post as Row).id as string;
  const { error: mErr } = await db.from("sub_post_media").insert(input.media.map((m, idx) => ({ post_id: id, idx, media_kind: m.kind, object_key: m.key, width: m.width ?? null, height: m.height ?? null })));
  if (mErr) {
    await db.from("sub_posts").delete().eq("id", id);
    return fail("Couldn't post that.", 500);
  }
  return { ok: true, id };
}

export interface SubPostCard {
  id: string;
  /** null for a viewer without access: the caption is part of the paid content */
  caption: string | null;
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
  createdAt: string;
}

/** The SUB POSTS gallery. A viewer without access sees covers and counts, nothing private. Cursor-paged. */
export async function listSubPosts(creatorId: string, viewerId: string | null, before?: string | null): Promise<{ posts: SubPostCard[]; access: boolean; isCreator: boolean; next: string | null; ready: boolean; accessUntil?: string | null }> {
  const db = createAdminClient();
  const isCreator = viewerId === creatorId;
  let q = db.from("sub_posts").select("id, caption, cover_url, created_at").eq("creator_id", creatorId).eq("status", "published").order("created_at", { ascending: false }).limit(PAGE + 1);
  if (before) q = q.lt("created_at", before);
  const [postsR, access] = await Promise.all([q, hasActiveSub(viewerId, creatorId)]);
  // a subscriber sees that they ARE one, and until when (2026-10-12) — read only for a subscriber
  let accessUntil: string | null = null;
  if (access && viewerId && !isCreator) {
    const { data: m } = await db.from("creator_memberships").select("period_end").eq("creator_id", creatorId).eq("member_id", viewerId).eq("status", "active").eq("billing", "sub").order("period_end", { ascending: false }).limit(1).maybeSingle();
    accessUntil = ((m as Row | null)?.period_end as string | null) ?? null;
  }
  if (postsR.error) return { posts: [], access, isCreator, next: null, ready: !MISSING(postsR.error.message) };
  const rows = (postsR.data ?? []) as Row[];
  const page = rows.slice(0, PAGE);
  const ids = page.map((r) => r.id as string);
  const { data: media } = ids.length ? await db.from("sub_post_media").select("post_id, media_kind").in("post_id", ids) : { data: [] };
  const counts = new Map<string, { n: number; video: boolean }>();
  for (const m of (media ?? []) as Row[]) {
    const c = counts.get(m.post_id as string) ?? { n: 0, video: false };
    c.n++;
    if (m.media_kind === "video") c.video = true;
    counts.set(m.post_id as string, c);
  }
  return {
    posts: page.map((r) => ({ id: r.id as string, caption: access ? ((r.caption as string | null) ?? null) : null, coverUrl: (r.cover_url as string | null) ?? null, items: counts.get(r.id as string)?.n ?? 0, hasVideo: counts.get(r.id as string)?.video ?? false, createdAt: r.created_at as string })),
    access,
    isCreator,
    next: rows.length > PAGE ? (page[page.length - 1]!.created_at as string) : null,
    ready: true,
    accessUntil,
  };
}

/** Opens one post for a viewer who may see it: the caption and five-minute links. Anyone else gets 403 and nothing. */
export async function openSubPost(postId: string, viewerId: string | null): Promise<{ ok: true; caption: string | null; media: { kind: "image" | "video"; url: string; width: number | null; height: number | null }[]; expiresAt: string; watermark: string | null } | Fail> {
  if (!viewerId) return fail("Sign in to view this.", 401);
  const db = createAdminClient();
  const { data: post } = await db.from("sub_posts").select("id, creator_id, caption, status").eq("id", postId).maybeSingle();
  const p = post as Row | null;
  if (!p || p.status !== "published") return fail("This post isn't available.", 404);
  if (!(await hasActiveSub(viewerId, p.creator_id as string))) return fail("Subscribe to see this post.", 403);
  if (!hasPrivateR2) return fail("Private storage isn't available right now.", 503);
  const { data: media } = await db.from("sub_post_media").select("idx, media_kind, object_key, width, height").eq("post_id", postId).order("idx");
  const items = await Promise.all(((media ?? []) as Row[]).map(async (m) => ({ kind: m.media_kind as "image" | "video", url: await presignPrivateGet(m.object_key as string, SIGNED_TTL_SECONDS), width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null })));
  // the watermark names the VIEWER by public handle only: never an email, phone or payout detail
  const [cfg, viewer] = await Promise.all([subConfig(), db.from("profiles").select("handle").eq("id", viewerId).maybeSingle()]);
  const handle = (viewer.data as Row | null)?.handle as string | undefined;
  return { ok: true, caption: (p.caption as string | null) ?? null, media: items, expiresAt: new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString(), watermark: cfg.watermark && viewerId !== p.creator_id && handle ? `@${handle}` : null };
}

export async function deleteSubPost(creatorId: string, postId: string): Promise<{ ok: true } | Fail> {
  const db = createAdminClient();
  const { data: media } = await db.from("sub_post_media").select("object_key, sub_posts!inner(creator_id)").eq("post_id", postId).eq("sub_posts.creator_id", creatorId);
  const { data, error } = await db.from("sub_posts").delete().eq("id", postId).eq("creator_id", creatorId).select("id");
  if (error) return fail("Couldn't delete that.", 500);
  if (!(data ?? []).length) return fail("Not found.", 404);
  await Promise.all(((media ?? []) as Row[]).map((m) => deletePrivate(m.object_key as string)));
  return { ok: true };
}
