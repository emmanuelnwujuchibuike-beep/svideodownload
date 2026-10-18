import "server-only";

import { after } from "next/server";

import { isAdult } from "@/lib/age/server";
import { makeSizedWebp } from "@/lib/media/thumbnail";
import { deletePrivate, hasPrivateR2, presignPrivateGet, presignPrivatePut, readPrivatePrefix } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

import { afterCursorFilter, audienceOf, decodeSubCursor, encodeSubCursor, isSubAudience, isUuid, type SubAudience, visibleTo } from "./guards";
import { hasActiveSub, subConfig } from "./server";
import { checkUpload } from "./upload-check";

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
 *
 * ── Mature (18+) posts (0261, owner 2026-10-18) ───────────────────────────
 * A creator may mark a post Mature: suggestive, violent or strong-language — never sexually
 * explicit, which stays banned. Its media, preview, caption and public cover reach only a viewer
 * whose age check says adult (lib/age/server.ts); the creator always sees their own post. Anyone
 * else gets the tile marked `mature` and `ageLocked`, and opening it answers 403 `age_required`.
 * Before 0261 runs there is no such column, and no post is Mature.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const SIGNED_TTL_SECONDS = 300;
const MAX_MEDIA = 10;
const PAGE = 24;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov"]);

export type Fail = { ok: false; error: string; status: number; code?: "age_required" };
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });
const AGE_REQUIRED: Fail = { ok: false, error: "Confirm your age to see this post.", status: 403, code: "age_required" };

/**
 * The post columns a gallery or gate reads, newest schema first: with Mature (0261) and audience
 * (0248), then audience only, then neither. Each step down is taken only when a column is missing —
 * so a database with 0248 but not 0261 still filters hidden posts (it never falls back past it).
 */
const POST_COLS = ["mature, audience", "audience", ""] as const;

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

export async function createSubPost(creatorId: string, input: { caption?: string | null; coverUrl?: string | null; media: { key: string; kind: string; width?: number | null; height?: number | null; thumbKey?: string | null }[]; audience?: unknown; mature?: unknown }): Promise<{ ok: true; id: string; audience: SubAudience; mature: boolean } | Fail> {
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
    // the preview obeys the same rule: the creator's OWN private folder, a jpg, nothing else
    if (m.thumbKey && (!m.thumbKey.startsWith(prefix) || m.thumbKey.includes("..") || !/^[A-Za-z0-9/._-]+\.jpg$/.test(m.thumbKey))) return fail("One of the files isn't yours to post.", 403);
  }
  /*
    Part 2 (2026-10-16): the bytes, not the browser's word. Each file (and each preview) is
    read back from private storage — one ranged read — and must really be a photo or video
    of the declared kind, within the size cap. A file that is missing or can't be read is
    refused, never let through (lib/sub/upload-check.ts).
  */
  const checks = await Promise.all(
    input.media.flatMap((m) => [
      readPrivatePrefix(m.key).then((h) => checkUpload(m.kind as "image" | "video", h)),
      ...(m.thumbKey ? [readPrivatePrefix(m.thumbKey).then((h) => checkUpload("image", h))] : []),
    ]),
  );
  const bad = checks.find((c) => !c.ok);
  if (bad && !bad.ok) return fail(bad.error, 422);
  // 0248: locked (the default) or hidden. A hidden post is NEVER published as locked: before 0248 it is refused.
  if (input.audience !== undefined && !isSubAudience(input.audience)) return fail("Choose who can see that this post exists.");
  const audience: SubAudience = input.audience === "hidden" ? "hidden" : "locked";
  if (input.mature !== undefined && typeof input.mature !== "boolean") return fail("Invalid request.");
  const mature = input.mature === true;
  let ins = await db.from("sub_posts").insert({ creator_id: creatorId, caption, cover_url: cover, audience, ...(mature ? { mature } : {}) }).select("id").single();
  // 0261 not applied: a Mature post is NEVER published as an ordinary one
  if (ins.error && /mature/.test(ins.error.message)) return fail("Mature posts arrive with the next update. Nothing was posted.", 503);
  if (ins.error && /audience/.test(ins.error.message)) {
    if (audience === "hidden") return fail("Hidden posts arrive with the next update. Nothing was posted.", 503);
    ins = await db.from("sub_posts").insert({ creator_id: creatorId, caption, cover_url: cover }).select("id").single();
  }
  const { data: post, error } = ins;
  if (error) return MISSING(error.message) ? fail("Subscriber posts arrive with the next update.", 503) : fail("Couldn't post that.", 500);
  const id = (post as Row).id as string;
  const rowsOf = (withThumb: boolean) => input.media.map((m, idx) => ({ post_id: id, idx, media_kind: m.kind, object_key: m.key, width: m.width ?? null, height: m.height ?? null, ...(withThumb ? { thumb_key: m.thumbKey ?? null } : {}) }));
  let { error: mErr } = await db.from("sub_post_media").insert(rowsOf(true));
  // 0237 (thumb_key) not applied yet: post without previews rather than fail
  if (mErr && MISSING(mErr.message)) ({ error: mErr } = await db.from("sub_post_media").insert(rowsOf(false)));
  if (mErr) {
    await db.from("sub_posts").delete().eq("id", id);
    return fail("Couldn't post that.", 500);
  }
  return { ok: true, id, audience, mature };
}

/** An opened post: the caption, five-minute links and the two marks. Only ever built AFTER an access check. */
export interface SubPostOpen {
  caption: string | null;
  media: { kind: "image" | "video"; url: string; width: number | null; height: number | null }[];
  expiresAt: string;
  watermark: string | null;
  creatorHandle: string | null;
  /** 0248: whether non-subscribers see a locked tile or nothing at all (only ever sent to someone with access) */
  audience?: SubAudience;
  /** 0261: Mature (18+) — only ever opened for an adult or the creator */
  mature?: boolean;
}

/**
 * The viewer's handle (the corner-hopping watermark) and the creator's (the profile link in that same mark),
 * read together. The watermark names the VIEWER by public handle only: never an email,
 * phone or payout detail; the creator's mark points to their PUBLIC profile, never to a
 * private post, which has no URL at all (owner 2026-10-12).
 */
async function marks(viewerId: string, creatorId: string): Promise<{ watermark: string | null; creatorHandle: string | null }> {
  const db = createAdminClient();
  const [cfg, viewer, creator] = await Promise.all([
    subConfig(),
    viewerId === creatorId ? Promise.resolve({ data: null }) : db.from("profiles").select("handle").eq("id", viewerId).maybeSingle(),
    db.from("profiles").select("handle").eq("id", creatorId).maybeSingle(),
  ]);
  const handle = (viewer.data as Row | null)?.handle as string | undefined;
  return { watermark: cfg.watermark && viewerId !== creatorId && handle ? `@${handle}` : null, creatorHandle: ((creator.data as Row | null)?.handle as string | undefined) ?? null };
}

async function signMedia(rows: Row[]): Promise<SubPostOpen["media"]> {
  return Promise.all(rows.map(async (m) => ({ kind: m.media_kind as "image" | "video", url: await presignPrivateGet(m.object_key as string, SIGNED_TTL_SECONDS), width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null })));
}

export interface SubPostCard {
  id: string;
  /**
   * For a viewer WITH access (owner 2026-10-12, "it shouldn't be verifying every entry"):
   * the gallery's one access check also opens the page's posts, so a tap shows the post at
   * once instead of a fresh check + a spinner per post. Links still expire in five minutes;
   * after that the viewer asks /api/sub/posts/[id], which checks access again.
   */
  open?: SubPostOpen;
  /** a subscriber's / the creator's small private preview (0237), signed like the media — the tile loads this first */
  thumbUrl?: string | null;
  /** null for a viewer without access: the caption is part of the paid content */
  caption: string | null;
  /** only for a viewer WITH access (a non-subscriber never receives a hidden post at all) */
  audience?: SubAudience;
  /** Part 4, creator only: Frenzsave took this post down (archived) — shown marked, not openable */
  removed?: true;
  /** 0261: Mature (18+). Sent to everyone who may see the tile, so it can carry its 18+ mark. */
  mature?: true;
  /** 0261: Mature and this viewer hasn't confirmed they're 18+ — no media, preview, caption or cover was sent */
  ageLocked?: true;
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
  createdAt: string;
}

/** The SUB POSTS gallery. A viewer without access sees covers and counts, nothing private. Cursor-paged. */
export async function listSubPosts(creatorId: string, viewerId: string | null, before?: string | null): Promise<{ posts: SubPostCard[]; access: boolean; isCreator: boolean; next: string | null; ready: boolean; accessUntil?: string | null; membership?: SubMembershipView; totals?: SubMediaTotals }> {
  const db = createAdminClient();
  const isCreator = viewerId === creatorId;
  /*
    Part 3 (0248): access is decided BEFORE the posts are read, because it decides WHICH posts
    exist for this viewer. A viewer without access never gets a 'hidden' row — not its id, its
    date, its count, nor a page cursor built from it (the cursor is the last row returned, so
    filtering after the read would have leaked the hidden post's id and timestamp in "next").
  */
  const access = await hasActiveSub(viewerId, creatorId);
  const cursor = decodeSubCursor(before);
  if (cursor === "invalid") return { posts: [], access, isCreator, next: null, ready: true };
  const read = (level: number) => {
    const extra = POST_COLS[level]!;
    const withAudience = extra.includes("audience");
    let q = db
      .from("sub_posts")
      .select(`id, caption, cover_url, created_at, status${extra ? `, ${extra}` : ""}`)
      .eq("creator_id", creatorId)
      // Part 4: the CREATOR also sees what Frenzsave took down (archived, Part 2) — marked, never openable.
      // Nobody else ever receives an archived row.
      .in("status", isCreator ? ["published", "archived"] : ["published"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE + 1);
    if (withAudience && !access) q = q.eq("audience", "locked");
    if (cursor) q = cursor.id ? q.or(afterCursorFilter({ at: cursor.at, id: cursor.id })) : q.lt("created_at", cursor.at);
    return q;
  };
  let postsR = await read(0);
  // before 0261 no post is Mature; before 0248 there is no audience column, so no post can be hidden
  if (postsR.error && MISSING(postsR.error.message)) postsR = await read(1);
  if (postsR.error && MISSING(postsR.error.message)) postsR = await read(2);
  // the visitor's OWN membership: subscribed until when, or ended when (Part 4: the offer card says
  // "Renew" to a lapsed subscriber). Read alongside the media below — one round trip fewer on every open.
  const untilRead =
    viewerId && !isCreator && isUuid(viewerId)
      ? db.from("creator_memberships").select("status, billing, period_end, ended_at").eq("creator_id", creatorId).eq("member_id", viewerId).maybeSingle()
      : Promise.resolve({ data: null });
  if (postsR.error) {
    const m = viewerId && !isCreator ? membershipView((await untilRead).data as Row | null, access) : undefined;
    return { posts: [], access, isCreator, next: null, ready: !MISSING(postsR.error.message), accessUntil: m?.state === "active" ? m.until : null, ...(m ? { membership: m } : {}) };
  }
  const rows = (postsR.data ?? []) as unknown as Row[];
  const page = rows.slice(0, PAGE);
  // 0261: a Mature post is withheld from anyone but the creator and a viewer who confirmed they're 18+ — asked once, only when the page has one
  const adult = isCreator || !page.some((r) => r.mature === true) ? true : await isAdult(viewerId).catch(() => false);
  const ageLocked = (r: Row) => r.mature === true && !adult;
  const ids = page.map((r) => r.id as string);
  const opening = access && !!viewerId && hasPrivateR2;
  const mediaRead = async (): Promise<{ data: Row[] | null }> => {
    if (!ids.length) return { data: [] };
    if (!opening) return (await db.from("sub_post_media").select("post_id, media_kind").in("post_id", ids).order("idx")) as { data: Row[] | null };
    const withThumb = await db.from("sub_post_media").select("post_id, idx, media_kind, object_key, width, height, thumb_key").in("post_id", ids).order("idx");
    if (!withThumb.error) return withThumb as { data: Row[] | null };
    return (await db.from("sub_post_media").select("post_id, idx, media_kind, object_key, width, height").in("post_id", ids).order("idx")) as { data: Row[] | null };
  };
  /*
    Owner 2026-10-17: a NON-subscriber sees how many videos and photos the creator has made here.
    Counted in the database over the posts this viewer may know exist (published and locked — a
    hidden post is never counted, so its existence never leaks), first page only. Null on any error
    (or before 0248 added audience): the gallery then simply shows no count.
  */
  const totalsRead = async (): Promise<SubMediaTotals | null> => {
    if (cursor || access || isCreator) return null;
    const count = async (kind: "image" | "video") => {
      const r = await db
        .from("sub_post_media")
        .select("id, sub_posts!inner(creator_id, status, audience)", { count: "exact", head: true })
        .eq("media_kind", kind)
        .eq("sub_posts.creator_id", creatorId)
        .eq("sub_posts.status", "published")
        .eq("sub_posts.audience", "locked");
      return r.error ? null : (r.count ?? 0);
    };
    const [images, videos] = await Promise.all([count("image"), count("video")]);
    return images === null || videos === null ? null : { images, videos };
  };
  const [{ data: media }, mk, until, totals] = await Promise.all([
    mediaRead(),
    opening && ids.length ? marks(viewerId!, creatorId) : Promise.resolve(null),
    untilRead,
    totalsRead().catch(() => null),
  ]);
  const membership = viewerId && !isCreator ? membershipView(until.data as Row | null, access) : undefined;
  const accessUntil = membership?.state === "active" ? membership.until : null;
  const counts = new Map<string, { n: number; video: boolean }>();
  for (const m of (media ?? []) as Row[]) {
    const c = counts.get(m.post_id as string) ?? { n: 0, video: false };
    c.n++;
    if (m.media_kind === "video") c.video = true;
    counts.set(m.post_id as string, c);
  }
  // a subscriber's page arrives opened (access already checked above, once)
  // older photos without a preview: the creator's own visit makes them, once each, after the response
  if (opening && isCreator) {
    const missing = ((media ?? []) as Row[]).filter((m) => m.media_kind === "image" && "thumb_key" in m && !m.thumb_key);
    if (missing.length) after(() => backfillThumbs(creatorId, missing.slice(0, 6)));
  }
  const opened = new Map<string, SubPostOpen>();
  const thumbs = new Map<string, string>();
  if (opening && mk) {
    const expiresAt = new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString();
    const byPost = new Map<string, Row[]>();
    for (const m of (media ?? []) as Row[]) byPost.set(m.post_id as string, [...(byPost.get(m.post_id as string) ?? []), m]);
    await Promise.all(
      page.map(async (r) => {
        const list = byPost.get(r.id as string) ?? [];
        // a Mature post this viewer may not see yet: no links of any kind
        if (ageLocked(r)) return;
        // a taken-down post is shown to its creator as a marked tile only: no media links
        if (r.status === "archived") {
          const t = list[0]?.thumb_key as string | null | undefined;
          if (t) thumbs.set(r.id as string, await presignPrivateGet(t, SIGNED_TTL_SECONDS));
          return;
        }
        const firstThumb = list[0]?.thumb_key as string | null | undefined;
        const [signed, thumb] = await Promise.all([signMedia(list), firstThumb ? presignPrivateGet(firstThumb, SIGNED_TTL_SECONDS) : Promise.resolve(null)]);
        opened.set(r.id as string, { caption: (r.caption as string | null) ?? null, audience: audienceOf(r.audience), ...(r.mature === true ? { mature: true } : {}), media: signed, expiresAt, ...mk });
        if (thumb) thumbs.set(r.id as string, thumb);
      }),
    );
  }
  return {
    posts: page.map((r) => ({ id: r.id as string, ...(access ? { audience: audienceOf(r.audience) } : {}), ...(r.mature === true ? { mature: true as const } : {}), ...(ageLocked(r) ? { ageLocked: true as const } : {}), caption: access && !ageLocked(r) ? ((r.caption as string | null) ?? null) : null, coverUrl: ageLocked(r) ? null : ((r.cover_url as string | null) ?? null), items: counts.get(r.id as string)?.n ?? 0, hasVideo: counts.get(r.id as string)?.video ?? false, createdAt: r.created_at as string, ...(r.status === "archived" ? { removed: true } : {}), ...(opened.has(r.id as string) ? { open: opened.get(r.id as string) } : {}), ...(thumbs.has(r.id as string) ? { thumbUrl: thumbs.get(r.id as string) } : {}) })),
    access,
    isCreator,
    next: rows.length > PAGE ? encodeSubCursor(page[page.length - 1]!.created_at as string, page[page.length - 1]!.id as string) : null,
    ready: true,
    accessUntil,
    ...(membership ? { membership } : {}),
    ...(totals ? { totals } : {}),
  };
}

/** How many photos and videos a creator's private posts hold, as a non-subscriber may see them. */
export interface SubMediaTotals {
  images: number;
  videos: number;
}

/** A visitor's own membership, as the offer card shows it (Part 4). Null for the creator and signed-out visitors. */
export type SubMembershipView = { state: "active"; until: string | null } | { state: "expired"; endedAt: string | null } | { state: "none" };

function membershipView(row: Row | null, access: boolean): SubMembershipView | undefined {
  if (access) return { state: "active", until: (row?.period_end as string | null | undefined) ?? null };
  if (!row || row.billing !== "sub") return { state: "none" };
  // a creator's removal is not announced here (checkout says so if they try); refunds end the period
  if (row.status === "removed") return { state: "none" };
  return { state: "expired", endedAt: ((row.ended_at ?? row.period_end) as string | null) ?? null };
}

/** Opens one post for a viewer who may see it: the caption and five-minute links. Anyone else gets 403 and nothing. */
export async function openSubPost(postId: string, viewerId: string | null): Promise<({ ok: true } & SubPostOpen) | Fail> {
  if (!viewerId) return fail("Sign in to view this.", 401);
  const db = createAdminClient();
  // the reads run together; the links are minted only after access says yes
  const [gate, { data: media }] = await Promise.all([
    readSubPostGate(postId, true),
    db.from("sub_post_media").select("idx, media_kind, object_key, width, height").eq("post_id", postId).order("idx"),
  ]);
  if (!gate) return fail("This post isn't available.", 404);
  const [access, mk] = await Promise.all([hasActiveSub(viewerId, gate.creatorId), marks(viewerId, gate.creatorId)]);
  // Part 3: a HIDDEN post answers a viewer without access exactly like a post that does not exist
  if (!access) return visibleTo(gate.audience, false) ? fail("Subscribe to see this post.", 403) : fail("This post isn't available.", 404);
  // 0261: a Mature post opens only for the creator or a viewer who confirmed they're 18+
  if (gate.mature && viewerId !== gate.creatorId && !(await isAdult(viewerId).catch(() => false))) return AGE_REQUIRED;
  if (!hasPrivateR2) return fail("Private storage isn't available right now.", 503);
  return { ok: true, caption: gate.caption, audience: gate.audience, ...(gate.mature ? { mature: true } : {}), media: await signMedia((media ?? []) as Row[]), expiresAt: new Date(Date.now() + SIGNED_TTL_SECONDS * 1000).toISOString(), ...mk };
}

/**
 * One published post's gate fields: who made it, and who may know it exists (0248). Null = not
 * there or not published (archived by a takedown, Part 2). Before 0248 there is no audience
 * column, and every post is 'locked'.
 */
export async function readSubPostGate(postId: string, withCaption = false): Promise<{ creatorId: string; audience: SubAudience; caption: string | null; mature: boolean } | null> {
  if (!isUuid(postId)) return null;
  const db = createAdminClient();
  const cols = `creator_id, status${withCaption ? ", caption" : ""}`;
  const at = (level: number) => db.from("sub_posts").select(POST_COLS[level] ? `${cols}, ${POST_COLS[level]}` : cols).eq("id", postId).maybeSingle();
  let res = await at(0);
  if (res.error && MISSING(res.error.message)) res = await at(1);
  if (res.error && MISSING(res.error.message)) res = await at(2);
  const p = res.data as Row | null;
  if (res.error || !p || p.status !== "published") return null;
  return { creatorId: p.creator_id as string, audience: audienceOf(p.audience), caption: (p.caption as string | null | undefined) ?? null, mature: p.mature === true };
}

/** The creator marks one of their own published posts Mature (18+) or not (0261). */
export async function setSubPostMature(creatorId: string, postId: string, mature: unknown): Promise<{ ok: true; mature: boolean } | Fail> {
  if (!isUuid(creatorId) || !isUuid(postId) || typeof mature !== "boolean") return fail("Invalid request.");
  const { data, error } = await createAdminClient().from("sub_posts").update({ mature, updated_at: new Date().toISOString() }).eq("id", postId).eq("creator_id", creatorId).eq("status", "published").select("id");
  if (error) return MISSING(error.message) ? fail("Mature posts arrive with the next update.", 503) : fail("Couldn't save that.", 500);
  return (data ?? []).length ? { ok: true, mature } : fail("Not found.", 404);
}

/** The creator switches one of their posts between 'locked' and 'hidden' (0248). Only their own, only while published. */
export async function setSubPostAudience(creatorId: string, postId: string, audience: unknown): Promise<{ ok: true } | Fail> {
  if (!isUuid(creatorId) || !isUuid(postId) || !isSubAudience(audience)) return fail("Invalid request.");
  const { data, error } = await createAdminClient().from("sub_posts").update({ audience, updated_at: new Date().toISOString() }).eq("id", postId).eq("creator_id", creatorId).eq("status", "published").select("id");
  if (error) return MISSING(error.message) ? fail("Hidden posts arrive with the next update.", 503) : fail("Couldn't save that.", 500);
  // someone else's post, a missing one or a taken-down one all answer the same
  return (data ?? []).length ? { ok: true } : fail("Not found.", 404);
}

export async function deleteSubPost(creatorId: string, postId: string): Promise<{ ok: true } | Fail> {
  const db = createAdminClient();
  // a post an admin took down (archived, Part 2) is kept as evidence: its creator can't delete it
  const { data: own } = await db.from("sub_posts").select("status").eq("id", postId).eq("creator_id", creatorId).maybeSingle();
  if ((own as Row | null)?.status === "archived") return fail("This post was removed by Frenzsave and is kept under review.", 409);
  const withThumb = await db.from("sub_post_media").select("object_key, thumb_key, sub_posts!inner(creator_id)").eq("post_id", postId).eq("sub_posts.creator_id", creatorId);
  // before 0237 there is no thumb_key — the originals are still removed
  const media: Row[] | null = withThumb.error
    ? ((await db.from("sub_post_media").select("object_key, sub_posts!inner(creator_id)").eq("post_id", postId).eq("sub_posts.creator_id", creatorId)).data as Row[] | null)
    : (withThumb.data as Row[] | null);
  const { data, error } = await db.from("sub_posts").delete().eq("id", postId).eq("creator_id", creatorId).select("id");
  if (error) return fail("Couldn't delete that.", 500);
  if (!(data ?? []).length) return fail("Not found.", 404);
  // the private previews go with their originals
  await Promise.all(((media ?? []) as Row[]).flatMap((m) => [m.object_key, m.thumb_key].filter((k): k is string => typeof k === "string" && !!k).map((k) => deletePrivate(k))));
  return { ok: true };
}

/**
 * Previews for photos posted before the composer made them (0237). Runs on Vercel after the
 * creator's own gallery response — never on a timer, never on Railway, at most six per visit,
 * once per file (a row that has a thumb_key is never touched again). Best effort.
 */
async function backfillThumbs(creatorId: string, rows: Row[]): Promise<void> {
  const db = createAdminClient();
  for (const m of rows) {
    try {
      const res = await fetch(await presignPrivateGet(m.object_key as string, 120));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 25 * 1024 * 1024) continue;
      const thumb = await makeSizedWebp(bytes, { maxWidth: 480, quality: 70 });
      if (!thumb) continue;
      const key = `sub/${creatorId}/${crypto.randomUUID()}-thumb.webp`;
      const put = await fetch(await presignPrivatePut(key, 120), { method: "PUT", body: new Uint8Array(thumb.buffer), headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store" } });
      if (!put.ok) continue;
      await db.from("sub_post_media").update({ thumb_key: key }).eq("post_id", m.post_id as string).eq("idx", m.idx as number).is("thumb_key", null);
    } catch {
      /* the tile keeps using the original */
    }
  }
}

/**
 * The creator edits the caption of one of their own PUBLISHED posts (Part 4). Same rules as
 * publishing: plain text, at most 2,200 characters, empty clears it. A taken-down (archived)
 * post can't be edited, and someone else's post answers exactly like a missing one.
 */
export async function setSubPostCaption(creatorId: string, postId: string, raw: unknown): Promise<{ ok: true; caption: string | null } | Fail> {
  if (!isUuid(creatorId) || !isUuid(postId) || (raw !== null && typeof raw !== "string")) return fail("Invalid request.");
  const caption = typeof raw === "string" ? raw.trim() || null : null;
  if (caption && (caption.length > 2200 || /[<>]/.test(caption))) return fail("Keep the caption to 2,200 characters of plain text.");
  const { data, error } = await createAdminClient().from("sub_posts").update({ caption, updated_at: new Date().toISOString() }).eq("id", postId).eq("creator_id", creatorId).eq("status", "published").select("id");
  if (error) return fail("Couldn't save that.", 500);
  return (data ?? []).length ? { ok: true, caption } : fail("Not found.", 404);
}
