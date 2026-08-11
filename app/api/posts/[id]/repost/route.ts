import { after, NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { pushSocialEvent } from "@/lib/push/social-push";
import { bumpEphemeralCount, peekEphemeralCount } from "@/lib/rate-limit";
import { parseAudience, type RepostAudience } from "@/lib/social/repost/audience";
import { checkRepostSpam, type RepostHistoryEntry } from "@/lib/social/repost/antispam";
import { recordAttribution } from "@/lib/social/repost/attribution";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function repostCount(db: ReturnType<typeof createAdminClient>, id: string): Promise<number> {
  try {
    const { data } = await db.from("posts").select("reposts_count").eq("id", id).maybeSingle();
    return (data?.reposts_count as number | null) ?? 0;
  } catch {
    return 0;
  }
}

const CAPTION_MAX = 300;

/** Normalize a caption: trim, collapse blank → null, enforce the 300 limit. */
function cleanCaption(raw: unknown): { ok: true; caption: string | null } | { ok: false } {
  if (raw == null) return { ok: true, caption: null };
  if (typeof raw !== "string") return { ok: false };
  const caption = raw.replace(/\r\n/g, "\n").trim();
  if (caption.length === 0) return { ok: true, caption: null };
  if (caption.length > CAPTION_MAX) return { ok: false };
  return { ok: true, caption };
}

/**
 * The quote repost's optional attachment.
 *
 * Validated to a closed shape rather than stored as whatever the client sent:
 * this value is rendered into an `<img>` on other people's feeds, so an
 * arbitrary object here is a stored-XSS vector wearing a personalisation
 * costume — the same reason `graph/circles.ts` stores a palette KEY and not a
 * hex string.
 */
function cleanQuoteMedia(raw: unknown): { ok: true; media: Record<string, unknown> | null } | { ok: false } {
  if (raw == null) return { ok: true, media: null };
  if (typeof raw !== "object") return { ok: false };
  const m = raw as { kind?: unknown; url?: unknown; width?: unknown; height?: unknown };
  if (m.kind !== "image" && m.kind !== "gif") return { ok: false };
  if (typeof m.url !== "string" || m.url.length > 2000) return { ok: false };
  // https only. A data: or javascript: URL must never reach an src attribute.
  if (!/^https:\/\//i.test(m.url)) return { ok: false };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 20000 ? Math.round(v) : null);
  return { ok: true, media: { kind: m.kind, url: m.url, width: num(m.width), height: num(m.height) } };
}

/** Redis key for "how many times has this member reposted-and-undone this post". */
const repeatKey = (userId: string, postId: string) => `repost-repeat:${userId}:${postId}`;
const REPEAT_TTL_S = 60 * 60 * 24;

/**
 * The reposter's recent history, for the pure anti-spam check.
 *
 * One query, bounded. It reads only rows that still exist, which is exactly why
 * `repeatsOfTarget` comes from a Redis counter instead: an undone repost leaves
 * nothing here to count.
 */
async function recentHistory(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<RepostHistoryEntry[]> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from("reposts")
      .select("post_id, caption, created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60);
    const rows = (data ?? []) as { post_id: string; caption: string | null; created_at: string }[];
    if (rows.length === 0) return [];
    const { data: posts } = await db
      .from("posts")
      .select("id, publisher_id")
      .in("id", rows.map((r) => r.post_id));
    const creatorOf = new Map(((posts ?? []) as { id: string; publisher_id: string }[]).map((p) => [p.id, p.publisher_id]));
    return rows.map((r) => ({
      postId: r.post_id,
      creatorId: creatorOf.get(r.post_id) ?? "",
      createdAt: Date.parse(r.created_at),
      hasCaption: !!r.caption,
    }));
  } catch {
    // No history readable means no evidence of abuse. Refusing on a failed
    // lookup would turn a database blip into a ban.
    return [];
  }
}

/**
 * POST /api/posts/:id/repost — recommend a post.
 *
 * Body (all optional): `caption` (the recommendation), `audience` (public →
 * private, see lib/social/repost/audience.ts), `sourceRepostId` (provenance —
 * which repost you found it through), `quoteMedia` (one attachment).
 *
 * PATCH — edit the caption (15-minute grace window), change the audience, or
 * pin/unpin. DELETE — undo. A repost is a pointer: it never copies the media.
 * Accepts a bearer token (native) or the cookie session.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to repost." }, { status: 401 });

  let body: { caption?: unknown; audience?: unknown; sourceRepostId?: unknown; quoteMedia?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* no body — quick repost */
  }

  const cleaned = cleanCaption(body.caption);
  if (!cleaned.ok) return NextResponse.json({ error: `Captions are up to ${CAPTION_MAX} characters.` }, { status: 400 });
  const media = cleanQuoteMedia(body.quoteMedia);
  if (!media.ok) return NextResponse.json({ error: "That attachment isn't supported." }, { status: 400 });
  // An unrecognised audience falls back to public rather than 400: the value is
  // a preference, and rejecting the whole repost over it loses the member's
  // action. `parseAudience` already refuses anything not in the table.
  const audience: RepostAudience = (body.audience == null ? null : parseAudience(body.audience)) ?? "public";

  const db = createAdminClient();
  const { data: post } = await db
    .from("posts")
    .select("publisher_id, visibility, status")
    .eq("id", id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (post.status !== "published" || post.visibility !== "public") {
    return NextResponse.json({ error: "This post can't be reposted." }, { status: 403 });
  }
  if (post.publisher_id === user.id) return NextResponse.json({ error: "You can't repost your own post." }, { status: 400 });

  // ── Provenance ────────────────────────────────────────────────────────────
  // A client hint, verified before it is trusted: the cited repost must exist
  // AND point at this same post. Otherwise it is dropped silently rather than
  // rejected — a stale id from a cached feed is a client bug, and losing the
  // member's repost over it would be the wrong trade.
  let sourceRepostId: string | null = null;
  if (typeof body.sourceRepostId === "string" && UUID.test(body.sourceRepostId)) {
    try {
      const { data: src } = await db
        .from("reposts")
        .select("id, post_id, user_id")
        .eq("id", body.sourceRepostId)
        .maybeSingle();
      if (src && src.post_id === id && src.user_id !== user.id) sourceRepostId = src.id as string;
    } catch {
      /* pre-migration or unreadable — no provenance, which is a valid state */
    }
  }

  // ── Anti-spam ─────────────────────────────────────────────────────────────
  const [history, repeats] = await Promise.all([
    recentHistory(db, user.id),
    peekEphemeralCount(repeatKey(user.id, id)),
  ]);
  const spam = checkRepostSpam({
    recent: history,
    repeatsOfTarget: repeats,
    targetCreatorId: post.publisher_id as string,
    now: Date.now(),
  });
  if (spam.verdict === "block") {
    return NextResponse.json(
      { error: spam.reasons[0] ?? "Try again shortly.", reasons: spam.reasons, retryAfterMs: spam.retryAfterMs },
      { status: 429, headers: spam.retryAfterMs ? { "Retry-After": String(Math.ceil(spam.retryAfterMs / 1000)) } : undefined },
    );
  }

  // Full row first; degrade column-by-column so the endpoint still works on a
  // database where 0116 (and even 0030) hasn't been applied. Same pattern as
  // `caption`'s original 42703 fallback.
  const full = {
    user_id: user.id,
    post_id: id,
    caption: cleaned.caption,
    audience,
    source_repost_id: sourceRepostId,
    quote_media: media.media,
    throttled_at: spam.verdict === "throttle" ? new Date().toISOString() : null,
  };
  const attempts: Record<string, unknown>[] = [
    full,
    { user_id: user.id, post_id: id, caption: cleaned.caption },
    { user_id: user.id, post_id: id },
  ];

  let inserted: { id: string } | null = null;
  for (const row of attempts) {
    const { data, error } = await db.from("reposts").insert(row).select("id").maybeSingle();
    if (!error) {
      inserted = (data as { id: string } | null) ?? null;
      break;
    }
    if (error.code === "23505") {
      // Already reposted → idempotent success.
      return NextResponse.json({ ok: true, reposted: true, audience, count: await repostCount(db, id) });
    }
    if (error.code === "42P01") {
      return NextResponse.json({ error: "Reposts aren't enabled yet." }, { status: 503 });
    }
    if (error.code !== "42703") {
      return NextResponse.json({ error: "Couldn't repost." }, { status: 500 });
    }
  }

  await bumpEphemeralCount(repeatKey(user.id, id), REPEAT_TTL_S);

  after(async () => {
    // Device push (the in-app notification row is created by the DB trigger).
    // after(), not bare void — Vercel can freeze a serverless function right
    // after it responds (see lib/social/messages.ts's sendMessage()).
    //
    // 🔴 Only a PUBLIC repost notifies the creator. Telling them about a
    // friends-only repost hands them a fact the reposter restricted.
    if (audience === "public") {
      await pushSocialEvent({ actorId: user.id, type: "repost", postId: id });
    }
    // A repost travelling onward is the strongest signal the source repost
    // produced anything — it is what Recommendation Circle™ weighs highest.
    if (sourceRepostId) {
      await recordAttribution({ repostId: sourceRepostId, postId: id, actorId: user.id, event: "repost" });
    }
  });

  return NextResponse.json({
    ok: true,
    reposted: true,
    audience,
    repostId: inserted?.id ?? null,
    throttled: spam.verdict === "throttle",
    count: await repostCount(db, id),
  });
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** GET — the viewer's own repost of this post (caption / audience / pin / edit window). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  const select = (cols: string) =>
    db.from("reposts").select(cols).eq("user_id", user.id).eq("post_id", id).maybeSingle();

  const rich = await select("id, caption, pinned_at, edited_at, created_at, audience, quote_media");
  if (!rich.error) {
    const row = rich.data as unknown as {
      id: string;
      caption: string | null;
      pinned_at: string | null;
      edited_at: string | null;
      created_at: string;
      audience: string | null;
      quote_media: unknown;
    } | null;
    if (!row) return NextResponse.json({ reposted: false });
    const createdAt = new Date(row.created_at).getTime();
    return NextResponse.json({
      reposted: true,
      repostId: row.id,
      caption: row.caption ?? null,
      audience: row.audience ?? "public",
      quoteMedia: row.quote_media ?? null,
      pinned: !!row.pinned_at,
      edited: !!row.edited_at,
      editableForMs: Math.max(0, EDIT_WINDOW_MS - (Date.now() - createdAt)),
    });
  }

  // 0116 columns absent — fall back to the 0030 shape, then to the 0025 shape.
  const mid = await select("id, caption, pinned_at, edited_at, created_at");
  if (!mid.error) {
    const row = mid.data as unknown as {
      id: string;
      caption: string | null;
      pinned_at: string | null;
      edited_at: string | null;
      created_at: string;
    } | null;
    if (!row) return NextResponse.json({ reposted: false });
    const createdAt = new Date(row.created_at).getTime();
    return NextResponse.json({
      reposted: true,
      repostId: row.id,
      caption: row.caption ?? null,
      audience: "public",
      quoteMedia: null,
      pinned: !!row.pinned_at,
      edited: !!row.edited_at,
      editableForMs: Math.max(0, EDIT_WINDOW_MS - (Date.now() - createdAt)),
    });
  }
  const { data } = await select("id, created_at");
  return NextResponse.json({
    reposted: !!data,
    repostId: (data as { id?: string } | null)?.id ?? null,
    caption: null,
    audience: "public",
    quoteMedia: null,
    pinned: false,
    edited: false,
    editableForMs: 0,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: { caption?: unknown; pinned?: unknown; audience?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: row } = await db
    .from("reposts")
    .select("id, created_at, caption, pinned_at")
    .eq("user_id", user.id)
    .eq("post_id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "You haven't reposted this." }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if ("caption" in body) {
    const cleaned = cleanCaption(body.caption);
    if (!cleaned.ok) return NextResponse.json({ error: `Captions are up to ${CAPTION_MAX} characters.` }, { status: 400 });
    const age = Date.now() - new Date(row.created_at as string).getTime();
    if (age > EDIT_WINDOW_MS) {
      return NextResponse.json({ error: "Captions can only be edited within 15 minutes." }, { status: 403 });
    }
    if (cleaned.caption !== (row.caption ?? null)) {
      patch.caption = cleaned.caption;
      patch.edited_at = new Date().toISOString();
    }
  }

  if ("pinned" in body) {
    patch.pinned_at = body.pinned ? new Date().toISOString() : null;
  }

  // 🔴 The audience has NO edit window, unlike the caption. Narrowing is a
  // privacy correction — "I didn't mean to share that publicly" — and a member
  // must be able to make it at any time. Widening is deliberately allowed too:
  // the alternative is a one-way ratchet that traps a mis-tap forever.
  if ("audience" in body) {
    const next = parseAudience(body.audience);
    if (!next) return NextResponse.json({ error: "Unknown audience." }, { status: 400 });
    patch.audience = next;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await db.from("reposts").update(patch).eq("id", row.id);
  if (error) {
    if (error.code === "42703" && "audience" in patch) {
      return NextResponse.json({ error: "Repost audiences aren't enabled yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Couldn't update the repost." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  try {
    await db.from("reposts").delete().eq("user_id", user.id).eq("post_id", id);
  } catch {
    /* table not migrated — treat as already-not-reposted */
  }
  return NextResponse.json({ ok: true, reposted: false, count: await repostCount(db, id) });
}
