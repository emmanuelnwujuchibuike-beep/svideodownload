/**
 * A paid ad's likes, shares and views as the full-screen ad shows them (0246).
 * Shared by the route (app/api/ads/engagement) and the client
 * (features/ads-platform/serve/ad-engagement.ts).
 */

export interface AdEngagement {
  /** qualifying impressions × the campaign's stats_multiplier (the admin x10 sample mode) */
  views: number;
  likes: number;
  shares: number;
  /** this person already liked it */
  liked: boolean;
}

/**
 * Who is reacting: a member by account ("u:<id>"), a signed-out visitor by the
 * anonymous visitor id ("v:<id>"). The database checks the same shape
 * (ad_campaign_reactions_actor_chk). Null when there is neither.
 */
export function actorKeyFor(userId: string | null, visitorId: string | null): string | null {
  if (userId && /^[0-9a-f-]{36}$/i.test(userId)) return `u:${userId}`;
  if (visitorId && /^[A-Za-z0-9_-]{8,64}$/.test(visitorId)) return `v:${visitorId}`;
  return null;
}

/** An answer from the route, or null for anything malformed (the ad then shows no counts). */
export function parseEngagement(raw: unknown): AdEngagement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.ok !== true) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const views = n(r.views);
  const likes = n(r.likes);
  const shares = n(r.shares);
  if (views === null || likes === null || shares === null) return null;
  return { views, likes, shares, liked: r.liked === true };
}


/**
 * The like count to show right after a tap (owner, 2026-10-16). The server's `likes` is the stored
 * count × the campaign's multiplier (0249), so showing it after a tap made ONE like jump by ten. The
 * shown count moves by exactly one, in the direction the server confirmed; the multiplied total is
 * what the next load shows. No answer from the server → what was shown before.
 */
export function likesAfterTap(before: AdEngagement, after: AdEngagement | null): AdEngagement {
  if (!after) return before;
  const delta = after.liked === before.liked ? 0 : after.liked ? 1 : -1;
  return { ...after, likes: Math.max(0, before.likes + delta) };
}
