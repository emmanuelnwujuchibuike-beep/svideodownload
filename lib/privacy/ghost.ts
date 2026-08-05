/**
 * Ghost Mode™ — the activity signals you give off (Feature 18 · Part 19).
 *
 * ── This builds almost nothing, and that is the point ─────────────────────
 * Every signal here ALREADY has storage and enforcement: read receipts and
 * typing indicators (0060), last seen (0060), activity visibility (0006),
 * profile view counts (0106), and an `invisible` presence status (0043). What
 * did not exist was any way to see them together or turn them down at once —
 * they were spread across three screens and a status picker, so "make me less
 * visible right now" meant knowing where all five lived.
 *
 * So this module is a MAP over existing columns, not a new store. Nothing here
 * introduces a setting; it names the ones that exist, says which storage each
 * belongs to, and defines what "ghost" means as a composite of them.
 *
 * ── Why a composite instead of one boolean ────────────────────────────────
 * A single `ghost_mode` column would be a sixth source of truth that has to be
 * kept in step with five existing ones, and the first time they disagreed a
 * member would believe they were hidden while their typing indicator still
 * showed. Ghost Mode is therefore DERIVED: it is on when every signal it
 * covers is off, and turning it on writes the underlying settings. Read the
 * parts, and the summary cannot lie about them.
 *
 * ── Reciprocity is stated, not hidden ─────────────────────────────────────
 * Read receipts are mutual by convention across every messaging product: if
 * you hide yours, you do not get to see other people's. `reciprocal` marks the
 * signals where that applies so the UI can say so BEFORE the switch is
 * flipped, rather than a member discovering it later and assuming a bug.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type GhostSignalKey =
  | "online_status"
  | "typing"
  | "read_receipts"
  | "last_seen"
  | "activity"
  | "profile_views";

export interface GhostSignalSpec {
  key: GhostSignalKey;
  label: string;
  /** What other people stop seeing. Written from THEIR side — it is the effect. */
  blurb: string;
  /** Which existing store holds it. No signal here has new storage. */
  source: "privacy_settings" | "user_presence_status";
  /** The column, where there is one. Presence is a status value, not a flag. */
  column: string | null;
  /**
   * True when hiding it also hides other people's from you. Named up front —
   * a member finding this out afterwards reads it as a bug.
   */
  reciprocal: boolean;
}

export const GHOST_SIGNALS: readonly GhostSignalSpec[] = [
  {
    key: "online_status",
    label: "Online status",
    blurb: "Nobody sees the green dot when you're using Frenz.",
    source: "user_presence_status",
    column: null,
    reciprocal: false,
  },
  {
    key: "last_seen",
    label: "Last seen",
    blurb: "Nobody sees when you were last active.",
    source: "privacy_settings",
    column: "last_seen_visibility",
    reciprocal: true,
  },
  {
    key: "typing",
    label: "Typing indicator",
    blurb: "People you're messaging don't see when you're typing.",
    source: "privacy_settings",
    column: "typing_indicators_enabled",
    reciprocal: true,
  },
  {
    key: "read_receipts",
    label: "Read receipts",
    blurb: "People don't see when you've read their message.",
    source: "privacy_settings",
    column: "read_receipts_enabled",
    reciprocal: true,
  },
  {
    key: "activity",
    label: "Activity",
    blurb: "Your likes, follows and posts stop appearing in activity feeds.",
    source: "privacy_settings",
    column: "activity_visibility",
    reciprocal: false,
  },
  {
    key: "profile_views",
    label: "Profile view count",
    blurb: "Your profile stops showing how many times it's been viewed.",
    source: "privacy_settings",
    column: "show_views",
    reciprocal: false,
  },
] as const;

const BY_KEY = new Map(GHOST_SIGNALS.map((s) => [s.key, s]));

export function ghostSignal(key: string): GhostSignalSpec | undefined {
  return BY_KEY.get(key as GhostSignalKey);
}

/** Signals whose reciprocity has to be spelled out before the switch is used. */
export function reciprocalSignals(): GhostSignalSpec[] {
  return GHOST_SIGNALS.filter((s) => s.reciprocal);
}

/** The current state of each signal: true = HIDDEN from other people. */
export type GhostState = Record<GhostSignalKey, boolean>;

/**
 * Read the composite state out of the settings that already exist.
 *
 * Each mapping is the honest reading of that column, not a guess:
 * `activity_visibility: "private"` is the only value that hides activity from
 * everyone, and `last_seen_visibility: "nobody"` likewise. A column missing —
 * before its migration, or for a member with no row — reads as NOT hidden,
 * because the platform defaults are all "visible" and pretending otherwise
 * would tell someone they are hidden when they are not.
 */
export function readGhostState(input: {
  presenceStatus?: string | null;
  lastSeenVisibility?: string | null;
  typingEnabled?: boolean | null;
  readReceiptsEnabled?: boolean | null;
  activityVisibility?: string | null;
  showViews?: boolean | null;
}): GhostState {
  return {
    online_status: input.presenceStatus === "invisible",
    last_seen: input.lastSeenVisibility === "nobody",
    typing: input.typingEnabled === false,
    read_receipts: input.readReceiptsEnabled === false,
    activity: input.activityVisibility === "private",
    profile_views: input.showViews === false,
  };
}

/** True only when EVERY signal is hidden. */
export function isFullyGhosted(state: GhostState): boolean {
  return GHOST_SIGNALS.every((s) => state[s.key]);
}

/** How many signals are currently hidden — the summary line. */
export function ghostedCount(state: GhostState): number {
  return GHOST_SIGNALS.filter((s) => state[s.key]).length;
}

/**
 * The writes needed to reach a target state, expressed in the EXISTING
 * columns. Split by store because they are two different endpoints, and
 * returning them together would tempt a caller into one request that half
 * succeeds.
 */
export interface GhostWrites {
  privacy: Record<string, unknown>;
  /** The presence status to set, or null when it should not change. */
  presence: "invisible" | "available" | null;
}

export function writesFor(target: Partial<GhostState>, current: GhostState): GhostWrites {
  const privacy: Record<string, unknown> = {};
  let presence: GhostWrites["presence"] = null;

  for (const signal of GHOST_SIGNALS) {
    const want = target[signal.key];
    if (want === undefined || want === current[signal.key]) continue;

    switch (signal.key) {
      case "online_status":
        // `available` rather than the member's previous status: we do not
        // store what they had before, and silently restoring "busy" or "do not
        // disturb" would be inventing an intent they never expressed.
        presence = want ? "invisible" : "available";
        break;
      case "last_seen":
        privacy.last_seen_visibility = want ? "nobody" : "everyone";
        break;
      case "typing":
        privacy.typing_indicators_enabled = !want;
        break;
      case "read_receipts":
        privacy.read_receipts_enabled = !want;
        break;
      case "activity":
        privacy.activity_visibility = want ? "private" : "public";
        break;
      case "profile_views":
        privacy.show_views = !want;
        break;
    }
  }

  return { privacy, presence };
}

/** Turn every signal on or off at once — the master switch. */
export function allSignals(hidden: boolean): GhostState {
  return Object.fromEntries(GHOST_SIGNALS.map((s) => [s.key, hidden])) as GhostState;
}
