import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Share Journey™ (Feature 15 Part 6 tranche 3) — a real, honest funnel, not
 * a propagation tree. Part 4's Social Ripple™ can draw a multi-hop tree
 * because `reposts.source_repost_id` records real provenance edges; a plain
 * share has none (§8 of FEATURE_15_PART_6_SHARING.md) — building a fake one
 * here would be exactly the "decorative, not data" mistake that doc already
 * refused to make for reposts. What IS real and buildable: how many share
 * actions happened, split by destination, and — only for DM/group shares,
 * where the recipient is actually known — how many of those recipients
 * later viewed the post. Copy-link/email/SMS/QR shares have no addressable
 * recipient, so "opened" for those stays unmeasured, never guessed at zero.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type ShareKind = "dm" | "group" | "copy_link" | "os_share" | "email" | "sms" | "qr";

export interface ShareJourney {
  totalShares: number;
  byKind: Partial<Record<ShareKind, number>>;
  /** Of DM/group shares (the only kind with a known recipient), how many
   *  distinct recipients later viewed the post. Null when there were no
   *  addressable shares to measure at all (not the same as zero). */
  addressableRecipients: number;
  recipientsWhoOpened: number;
}

const EMPTY: ShareJourney = { totalShares: 0, byKind: {}, addressableRecipients: 0, recipientsWhoOpened: 0 };

export async function getShareJourney(creatorId: string, postLimit = 200): Promise<ShareJourney> {
  if (!hasSupabase) return EMPTY;
  try {
    const db = createAdminClient();

    const { data: postRows } = await db.from("posts").select("id").eq("publisher_id", creatorId).limit(postLimit);
    const postIds = (postRows ?? []).map((p) => p.id as string);
    if (postIds.length === 0) return EMPTY;

    const { data: eventRows } = await db
      .from("share_events")
      .select("post_id, kind, recipient_ids, created_at")
      .in("post_id", postIds)
      .limit(5000);
    const events = (eventRows ?? []) as { post_id: string; kind: string; recipient_ids: string[] | null; created_at: string }[];
    if (events.length === 0) return EMPTY;

    const byKind: Partial<Record<ShareKind, number>> = {};
    for (const e of events) {
      const k = e.kind as ShareKind;
      byKind[k] = (byKind[k] ?? 0) + 1;
    }

    // Every distinct (post_id, recipient) pair from addressable shares.
    const addressablePairs = new Set<string>();
    const addressableSince = new Map<string, number>(); // `${postId}:${recipientId}` -> earliest share time
    for (const e of events) {
      if (!e.recipient_ids || e.recipient_ids.length === 0) continue;
      const t = new Date(e.created_at).getTime();
      for (const rid of e.recipient_ids) {
        const key = `${e.post_id}:${rid}`;
        addressablePairs.add(key);
        const prev = addressableSince.get(key);
        if (prev == null || t < prev) addressableSince.set(key, t);
      }
    }
    if (addressablePairs.size === 0) {
      return { totalShares: events.length, byKind, addressableRecipients: 0, recipientsWhoOpened: 0 };
    }

    const allRecipientIds = [...new Set(events.flatMap((e) => e.recipient_ids ?? []))];
    const { data: viewRows } = await db
      .from("post_views")
      .select("post_id, viewer_id, created_at")
      .in("post_id", postIds)
      .in("viewer_id", allRecipientIds)
      .limit(10_000);
    const views = (viewRows ?? []) as { post_id: string; viewer_id: string | null; created_at: string }[];

    let opened = 0;
    for (const key of addressablePairs) {
      const [postId, recipientId] = key.split(":");
      const sharedAt = addressableSince.get(key)!;
      const wasViewed = views.some((v) => v.post_id === postId && v.viewer_id === recipientId && new Date(v.created_at).getTime() >= sharedAt);
      if (wasViewed) opened += 1;
    }

    return { totalShares: events.length, byKind, addressableRecipients: addressablePairs.size, recipientsWhoOpened: opened };
  } catch {
    return EMPTY;
  }
}
