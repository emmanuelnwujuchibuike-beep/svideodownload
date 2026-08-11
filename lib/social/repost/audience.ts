/**
 * Repost audience — who a recommendation actually reaches (Feature 15 · Part 4).
 *
 * ── Why this is a table and not an `if` ───────────────────────────────────
 * The sheet's rows and the server's filter both read THIS file. That is the
 * same discipline `reshare-rules.ts` runs under and it exists for one reason: a
 * button that says "Close friends only" and a query that forgets to filter are
 * a privacy breach that no screenshot review catches. If the promise and the
 * enforcement are the same table, they cannot drift.
 *
 * ── Why a repost can have an audience when a POST still cannot ────────────
 * Social Circles (Part 17) had to leave `post_audience` unbuilt because
 * `posts.visibility` is a CHECK constraint referenced by the feed indexes and by
 * an RLS policy a dozen queries depend on — widening it means rewriting all of
 * them, and getting it half right leaks a private post.
 *
 * A repost is not a post. It is a pointer row in its own table, read by exactly
 * one code path (distribution). Adding an audience here changes nothing about
 * how the original post is stored, indexed or authorised. That asymmetry is the
 * whole reason this ships in Part 4 and post audience did not ship in Part 17.
 *
 * ── The default is the widest, on purpose ─────────────────────────────────
 * Every repost written before migration 0116 is `public`, because that is what
 * it WAS. Retro-narrowing something a member already published is a silent
 * change to their public record.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type RepostAudience = "public" | "followers" | "friends" | "close_friends" | "private";

/** The viewer's relationship to the REPOSTER. Everything here is already known to the app. */
export interface ViewerRelation {
  /** The viewer is the reposter. */
  isSelf: boolean;
  /** The viewer follows the reposter. */
  follows: boolean;
  /** Mutual, agreed friendship. */
  isFriend: boolean;
  /** The reposter pinned the viewer as a favourite (`friend_favorites`). */
  isCloseFriend: boolean;
}

export interface RepostAudienceSpec {
  key: RepostAudience;
  /** Row label in the sheet. */
  label: string;
  /** One line under the label — states the reach in plain words. */
  blurb: string;
  /** Compact form, shown on the reposter's own repost so reach is never a mystery. */
  badge: string;
  /**
   * Does this repost appear on the public profile Reposts tab and contribute to
   * the post's public repost count?
   *
   * 🔴 Only `public` does. A private repost that still bumped a public counter
   * would leak its existence — the count is the leak, not the row.
   */
  publiclyCounted: boolean;
}

export const REPOST_AUDIENCES: readonly RepostAudienceSpec[] = [
  {
    key: "public",
    label: "Everyone",
    blurb: "Anyone can see it, and it appears on your profile.",
    badge: "Public",
    publiclyCounted: true,
  },
  {
    key: "followers",
    label: "Your followers",
    blurb: "The people who follow you. Not shown on your public profile.",
    badge: "Followers",
    publiclyCounted: false,
  },
  {
    key: "friends",
    label: "Friends",
    blurb: "Only people you're actually friends with.",
    badge: "Friends",
    publiclyCounted: false,
  },
  {
    key: "close_friends",
    label: "Close friends",
    blurb: "Only the friends you've marked as favourites.",
    badge: "Close friends",
    publiclyCounted: false,
  },
  {
    key: "private",
    label: "Only me",
    blurb: "A private recommendation you keep for yourself.",
    badge: "Only me",
    publiclyCounted: false,
  },
] as const;

const BY_KEY = new Map(REPOST_AUDIENCES.map((a) => [a.key, a]));
const PUBLIC_SPEC = REPOST_AUDIENCES[0]!;

export function audienceSpec(key: RepostAudience): RepostAudienceSpec {
  return BY_KEY.get(key) ?? PUBLIC_SPEC;
}

/** Narrow an untrusted string (a request body) to a real audience, or null. */
export function parseAudience(raw: unknown): RepostAudience | null {
  return typeof raw === "string" && BY_KEY.has(raw as RepostAudience) ? (raw as RepostAudience) : null;
}

/**
 * May this viewer see this repost?
 *
 * The reposter always sees their own — including `private`, which is the entire
 * point of that setting. Everything else is a widening ladder, and each rung
 * checks the relationship it names rather than assuming the rung below implies
 * it: a follower is not a friend, and a friend is not necessarily a close one.
 */
export function canSeeRepost(audience: RepostAudience, rel: ViewerRelation): boolean {
  if (rel.isSelf) return true;
  switch (audience) {
    case "public":
      return true;
    case "followers":
      // A friend who somehow doesn't follow you still counts — friendship is the
      // stronger, mutually-agreed relationship, and excluding them would read as
      // a bug to both people.
      return rel.follows || rel.isFriend;
    case "friends":
      return rel.isFriend;
    case "close_friends":
      return rel.isCloseFriend;
    case "private":
      return false;
    default:
      // An audience this build doesn't recognise (a newer client wrote it) is
      // treated as the NARROWEST possible, never the widest. Failing open here
      // would publish something a future version deliberately restricted.
      return false;
  }
}

/** Does this repost count toward the post's public repost total? */
export function isPubliclyCounted(audience: RepostAudience): boolean {
  return audienceSpec(audience).publiclyCounted && audience === "public";
}

// ── Destinations: the rows of the repost sheet ────────────────────────────

export type RepostDestination =
  | "instant"
  | "quote"
  | "audience"
  | "story"
  | "chat"
  | "save"
  | "copy";

export interface DestinationSpec {
  key: RepostDestination;
  label: string;
  blurb: string;
  /**
   * Live means: tapping this row reaches a real destination today.
   *
   * The dead ones are enumerated here rather than deleted so the reason is
   * recorded in code — but the sheet renders only `live` rows. A disabled
   * control advertises an action that will never work, which is the mistake
   * `reshare-sheet.tsx` already corrected once ("hidden, not greyed").
   */
  live: boolean;
  /** For non-live destinations: the concrete blocker. */
  needs?: string;
}

export const REPOST_DESTINATIONS: readonly DestinationSpec[] = [
  { key: "instant", label: "Repost", blurb: "Share it with your followers now.", live: true },
  { key: "quote", label: "Add your thoughts", blurb: "Say why you're recommending it.", live: true },
  { key: "audience", label: "Choose who sees it", blurb: "Friends, close friends, or just you.", live: true },
  { key: "chat", label: "Send in chat", blurb: "To a person or a group conversation.", live: true },
  { key: "save", label: "Save for later", blurb: "Into one of your collections.", live: true },
  { key: "copy", label: "Copy link", blurb: "", live: true },
  {
    key: "story",
    label: "Repost to your story",
    blurb: "",
    live: false,
    needs:
      "There is no post→story path. `reshare-rules.ts` defines ReshareSource as message|story only, so a POST has no route to a story — resharing was built for chat media and other people's stories, not for feed posts. Needs a story composer that accepts a post as its source.",
  },
  {
    key: "community" as RepostDestination,
    label: "Repost to a community",
    blurb: "",
    live: false,
    needs:
      "There is no communities table in this schema. Communities are their own product (Part 4 doc §10), not a row on this sheet.",
  },
] as const;

/** The rows the sheet actually renders. */
export const LIVE_DESTINATIONS: readonly DestinationSpec[] = REPOST_DESTINATIONS.filter((d) => d.live);
