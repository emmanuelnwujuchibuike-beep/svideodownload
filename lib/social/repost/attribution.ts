import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The attribution ledger — what a repost actually caused (Feature 15 · Part 4).
 *
 * ── Every analytics number in this feature is a count of rows in here ─────
 * Nothing is estimated, extrapolated or sampled. A repost that nobody saw shows
 * "No reach yet", because that is the true and common state. The alternative —
 * a plausible-looking number derived from a post's total views — is the
 * fabricated proof this project has declined three times.
 *
 * ── Identity goes IN so it can be deduped, and never comes OUT ────────────
 * `actor_id` exists for exactly one reason: a unique index on (repost, actor,
 * event) means scrolling past twice, or liking → unliking → liking, cannot
 * inflate anything. No function in this module returns actor ids for
 * impressions or opens, and no API exposes them. Reach is a NUMBER. "Who looked
 * at your repost" is not a question this product answers.
 *
 * The exception is `follow_creator`, and it is still a count: Discovery Bridge™
 * tells you THAT your recommendation grew a creator's audience, never who.
 *
 * ── Best-effort, always ───────────────────────────────────────────────────
 * Recording is fire-and-forget: a failed insert must never break a like, an
 * open or a feed render. Reading returns zeroes when the table isn't migrated.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type AttributionEvent =
  | "impression"
  | "open"
  | "like"
  | "comment"
  | "save"
  | "repost"
  | "follow_creator";

export const ATTRIBUTION_EVENTS: readonly AttributionEvent[] = [
  "impression",
  "open",
  "like",
  "comment",
  "save",
  "repost",
  "follow_creator",
];

export function isAttributionEvent(v: unknown): v is AttributionEvent {
  return typeof v === "string" && (ATTRIBUTION_EVENTS as readonly string[]).includes(v);
}

export interface AttributionInput {
  repostId: string;
  postId: string;
  /** Null for a signed-out viewer — those collapse to one row per repost per event. */
  actorId: string | null;
  event: AttributionEvent;
}

export type AttributionCounts = Record<AttributionEvent, number>;

export function emptyCounts(): AttributionCounts {
  return { impression: 0, open: 0, like: 0, comment: 0, save: 0, repost: 0, follow_creator: 0 };
}

/**
 * Record one attribution. Silently idempotent.
 *
 * 23505 (unique violation) is a SUCCESS here, not an error — it is the dedupe
 * doing its job on the second impression of the same repost.
 */
export async function recordAttribution(input: AttributionInput): Promise<void> {
  if (!hasSupabase) return;
  // NOTE: self-attribution (a member's own action on their own repost) is
  // filtered by the CALLER — `/api/reposts/attribution` drops those for a whole
  // batch in one query. Doing it here would mean a lookup per event on a path
  // that runs once per feed card.
  try {
    const db = createAdminClient();
    const { error } = await db.from("repost_attributions").insert({
      repost_id: input.repostId,
      post_id: input.postId,
      actor_id: input.actorId,
      event: input.event,
    });
    if (error && error.code !== "23505") return; // 42P01 pre-migration, 23503 deleted repost
    if (!error && input.event === "follow_creator") {
      await notifyDiscoveryBridge(db, input);
    }
  } catch {
    /* attribution is never worth failing a request for */
  }
}

/** Record several at once (the batching client sends a small array). */
export async function recordAttributions(inputs: readonly AttributionInput[]): Promise<void> {
  if (!hasSupabase || inputs.length === 0) return;
  try {
    const db = createAdminClient();
    // upsert-ignore rather than insert: one duplicate in a batch must not
    // discard the other nine rows, which a plain multi-row insert would do.
    await db.from("repost_attributions").upsert(
      inputs.map((i) => ({
        repost_id: i.repostId,
        post_id: i.postId,
        actor_id: i.actorId,
        event: i.event,
      })),
      { ignoreDuplicates: true, onConflict: "repost_id,event,actor_id" },
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Discovery Bridge™ — tell the reposter that their recommendation grew a
 * creator's audience.
 *
 * Deliberately NOT a database trigger, unlike the repost-engagement
 * notification in 0036: the attributing action (a follow) happens in
 * application code that already knows which repost it came through, and a
 * trigger on `repost_attributions` would have to re-derive that. The
 * notification's dedupe index means a repeat cannot double-notify.
 */
async function notifyDiscoveryBridge(
  db: ReturnType<typeof createAdminClient>,
  input: AttributionInput,
): Promise<void> {
  try {
    const { data: repost } = await db
      .from("reposts")
      .select("user_id")
      .eq("id", input.repostId)
      .maybeSingle();
    const reposterId = (repost?.user_id as string | undefined) ?? null;
    // Never notify someone about their own action, and never notify on a repost
    // that has since been removed.
    if (!reposterId || reposterId === input.actorId) return;
    await db.from("notifications").insert({
      user_id: reposterId,
      actor_id: input.actorId,
      type: "repost_discovery",
      post_id: input.postId,
    });
  } catch {
    /* the notification type arrives with 0116 — pre-migration this is a no-op */
  }
}

/** Counts per event for one repost. */
export async function countsForRepost(repostId: string): Promise<AttributionCounts> {
  const map = await countsForReposts([repostId]);
  return map.get(repostId) ?? emptyCounts();
}

/**
 * Counts per event for many reposts, in ONE round trip.
 *
 * Aggregated in memory rather than with a grouped SQL count because PostgREST
 * has no group-by: the alternative is seven count queries per repost, which is
 * how a "cheap" analytics panel becomes the slowest request on the page.
 */
export async function countsForReposts(repostIds: readonly string[]): Promise<Map<string, AttributionCounts>> {
  const out = new Map<string, AttributionCounts>();
  if (!hasSupabase || repostIds.length === 0) return out;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("repost_attributions")
      .select("repost_id, event")
      .in("repost_id", repostIds.slice(0, 200));
    for (const r of (data ?? []) as { repost_id: string; event: AttributionEvent }[]) {
      const c = out.get(r.repost_id) ?? emptyCounts();
      if (r.event in c) c[r.event] += 1;
      out.set(r.repost_id, c);
    }
  } catch {
    /* not migrated */
  }
  return out;
}

/** Every attribution a member's own reposts have generated, summed. */
export async function countsForReposter(userId: string): Promise<{ counts: AttributionCounts; reposts: number; distinctCreators: number }> {
  const empty = { counts: emptyCounts(), reposts: 0, distinctCreators: 0 };
  if (!hasSupabase) return empty;
  try {
    const db = createAdminClient();
    const { data: mine } = await db
      .from("reposts")
      .select("id, post_id")
      .eq("user_id", userId)
      .limit(500);
    const rows = (mine ?? []) as { id: string; post_id: string }[];
    if (rows.length === 0) return empty;

    const [{ data: posts }, perRepost] = await Promise.all([
      db.from("posts").select("id, publisher_id").in("id", rows.map((r) => r.post_id)),
      countsForReposts(rows.map((r) => r.id)),
    ]);

    const counts = emptyCounts();
    for (const c of perRepost.values()) {
      for (const k of ATTRIBUTION_EVENTS) counts[k] += c[k];
    }
    const creators = new Set(((posts ?? []) as { publisher_id: string }[]).map((p) => p.publisher_id));
    return { counts, reposts: rows.length, distinctCreators: creators.size };
  } catch {
    return empty;
  }
}
