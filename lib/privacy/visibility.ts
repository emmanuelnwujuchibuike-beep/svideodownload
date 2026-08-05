/**
 * "Who can see you" — the privacy summary, in plain language
 * (Feature 18 · Part 19).
 *
 * ── The brief's real problem is READABILITY, not settings ─────────────────
 * The ask is "every user should understand exactly who can see them". Frenz
 * already HAS the controls — roughly twenty columns across privacy_settings,
 * profile_discovery, and the profile's own visibility. What it did not have is
 * any place that answers the question. A member had five screens of switches
 * and no sentence.
 *
 * So this module adds no setting. It reads what is already stored and states
 * the consequence, one line per audience, in the words someone would use
 * themselves — "Anyone on the internet can see your posts" rather than
 * "activity_visibility: public".
 *
 * ── Why the summary is derived and never stored ──────────────────────────
 * A cached summary is a summary that can be wrong. Every line here is computed
 * from the same columns the enforcement reads, so the sentence and the
 * behaviour cannot drift — if the summary says strangers cannot see your
 * friends, it is because the code that hides them read the identical value.
 *
 * ── Tone ─────────────────────────────────────────────────────────────────
 * `level` exists so the UI can mark the widest settings, NOT to scold. Public
 * is a legitimate, common, often correct choice; a profile that shouts warnings
 * at a creator for being findable trains them to ignore the one warning that
 * matters. `open` means "the widest option", never "wrong".
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type ExposureLevel = "open" | "limited" | "closed";

export interface VisibilityLine {
  key: string;
  /** What this covers, in the member's words. */
  label: string;
  /** The consequence, as a full sentence. */
  statement: string;
  level: ExposureLevel;
  /** Where to change it. */
  href: string;
}

export interface VisibilityInput {
  /** `profiles.visibility` — the profile itself. */
  profileVisibility?: string | null;
  /** Admin-applied friends-only confinement (migration 0082). */
  isHidden?: boolean | null;
  activityVisibility?: string | null;
  followersVisibility?: string | null;
  friendsVisibility?: string | null;
  followingVisibility?: string | null;
  commentsPolicy?: string | null;
  messagesPolicy?: string | null;
  allowIndexing?: boolean | null;
  showInRecommendations?: boolean | null;
  /** profile_discovery (0113). */
  discoverable?: boolean | null;
  /** Optional discovery fields the member switched on. */
  discoveryFields?: readonly string[] | null;
}

const AUDIENCE_WORDS: Record<string, string> = {
  public: "Anyone",
  everyone: "Anyone",
  followers: "Your followers",
  friends: "Your friends",
  private: "Only you",
  nobody: "Nobody",
  off: "Nobody",
};

function words(value: string | null | undefined, fallback: string): string {
  return AUDIENCE_WORDS[value ?? ""] ?? fallback;
}

function levelOf(value: string | null | undefined): ExposureLevel {
  switch (value) {
    case "public":
    case "everyone":
      return "open";
    case "private":
    case "nobody":
    case "off":
      return "closed";
    default:
      return "limited";
  }
}

/**
 * The summary. Ordered by what people actually worry about: the profile
 * itself, then what they post, then who can reach them, then findability.
 */
export function visibilitySummary(input: VisibilityInput): VisibilityLine[] {
  const lines: VisibilityLine[] = [];

  // ── The profile ──────────────────────────────────────────────────────
  // A hidden account is friends-only whatever its own setting says, so the
  // stricter of the two is reported — never the more flattering one.
  const hidden = input.isHidden === true;
  const profileValue = hidden ? "friends" : (input.profileVisibility ?? "public");
  lines.push({
    key: "profile",
    label: "Your profile",
    statement: hidden
      ? "Only your friends can see your profile. An admin limited it — you keep every ability, just with your friends."
      : `${words(profileValue, "Anyone")} can see your profile.`,
    level: hidden ? "limited" : levelOf(profileValue),
    href: "/account/privacy",
  });

  lines.push({
    key: "activity",
    label: "Your activity",
    statement: `${words(input.activityVisibility, "Anyone")} can see what you like, follow and post.`,
    level: levelOf(input.activityVisibility ?? "public"),
    href: "/account/privacy",
  });

  // ── Connections ──────────────────────────────────────────────────────
  lines.push({
    key: "friends",
    label: "Your friends list",
    // Defaults to `friends` (migration 0112) — the only one of these that
    // starts closed, because a friend list maps a real-world circle.
    statement: `${words(input.friendsVisibility ?? "friends", "Your friends")} can see who you're friends with.`,
    level: levelOf(input.friendsVisibility ?? "friends"),
    href: "/account/relationships",
  });

  lines.push({
    key: "followers",
    label: "Your followers",
    statement: `${words(input.followersVisibility, "Anyone")} can see who follows you.`,
    level: levelOf(input.followersVisibility ?? "public"),
    href: "/account/relationships",
  });

  // ── Reaching you ─────────────────────────────────────────────────────
  lines.push({
    key: "messages",
    label: "Messages",
    statement: `${words(input.messagesPolicy ?? "followers", "Your followers")} can message you.`,
    level: levelOf(input.messagesPolicy ?? "followers"),
    href: "/account/privacy",
  });

  lines.push({
    key: "comments",
    label: "Comments",
    statement: `${words(input.commentsPolicy ?? "everyone", "Anyone")} can comment on your posts.`,
    level: levelOf(input.commentsPolicy ?? "everyone"),
    href: "/account/privacy",
  });

  // ── Being found ──────────────────────────────────────────────────────
  const discoverable = input.discoverable !== false;
  const fields = input.discoveryFields ?? [];
  const byLocation = fields.includes("city") || fields.includes("country");
  lines.push({
    key: "search",
    label: "Search on Frenz",
    statement: discoverable
      ? byLocation
        ? "People can find you by name, by what you do, and by where you are."
        : "People can find you by name and by what you do — not by location."
      : "Only someone who already knows your exact @username can find you.",
    level: discoverable ? (byLocation ? "open" : "limited") : "closed",
    href: "/account/discovery",
  });

  lines.push({
    key: "indexing",
    label: "Search engines",
    statement:
      input.allowIndexing === false
        ? "Google and other search engines are asked not to list your profile."
        : "Your profile can appear in Google and other search engines.",
    level: input.allowIndexing === false ? "closed" : "open",
    href: "/account/privacy",
  });

  lines.push({
    key: "recommendations",
    label: "Suggestions",
    statement:
      input.showInRecommendations === false
        ? "You're never suggested to other people."
        : "You can be suggested to people who might know you.",
    level: input.showInRecommendations === false ? "closed" : "limited",
    href: "/account/discovery",
  });

  return lines;
}

/** A one-line headline for the top of the Privacy Centre. */
export function visibilityHeadline(lines: readonly VisibilityLine[]): string {
  const open = lines.filter((l) => l.level === "open").length;
  const closed = lines.filter((l) => l.level === "closed").length;

  if (open === 0 && closed >= lines.length / 2) return "Your account is closed down tight.";
  if (open === 0) return "Nothing about you is fully public.";
  if (open >= lines.length - 1) return "Most of your account is public.";
  return `${open} of ${lines.length} things about you are public.`;
}

/** How many of each level — drives the summary chips. */
export function countLevels(lines: readonly VisibilityLine[]): Record<ExposureLevel, number> {
  return {
    open: lines.filter((l) => l.level === "open").length,
    limited: lines.filter((l) => l.level === "limited").length,
    closed: lines.filter((l) => l.level === "closed").length,
  };
}
