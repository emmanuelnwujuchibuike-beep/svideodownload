/**
 * Social Circles™ — private groups with real permissions (Feature 18 · Part 17).
 *
 * ── A circle that gates nothing is a folder ───────────────────────────────
 * The brief asks for circles with "independent permissions". The temptation is
 * to ship the folder — create, name, colour, drag people in — and put an
 * audience picker on the composer that silently publishes to "followers"
 * anyway. That is worse than not shipping it: a member would put four people
 * in "Family", post something for them, and reach every follower they have.
 *
 * So every permission a circle can hold is enumerated here with a `live` flag,
 * and the UI renders the planned ones as plainly unavailable. Exactly one
 * permission is live at launch, and it is live because it can be enforced
 * end-to-end today:
 *
 *   profile_modules — the Universal Profile Engine (Part 14) applies module
 *     audience in CODE (`lib/profile/engine.ts`), not in an RLS policy. So
 *     "only my Family circle sees my contact details" is a real check on a
 *     real membership row, on the one surface where adding an audience does
 *     not mean rewriting a policy that twenty other queries depend on.
 *
 * Posts and stories are deliberately NOT live. `posts.visibility` is a CHECK
 * constraint referenced by the feed indexes and by an RLS policy that decides
 * who can read a row; widening it to `circle:<uuid>` is a schema change plus a
 * policy rewrite plus a migration of every feed query — and getting it half
 * right leaks a private post. That is its own part, not a footnote in this one.
 *
 * ── Colours come from a fixed palette, never from input ───────────────────
 * A circle colour is rendered into a class name and an inline gradient. Taking
 * a hex string from a request and interpolating it into a style attribute is
 * how you get CSS injection from a "harmless" personalisation field, so the
 * stored value is a palette KEY and the CSS lives here.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface CirclePermissionSpec {
  key: CirclePermissionKey;
  label: string;
  blurb: string;
  live: boolean;
  /** For planned permissions: the concrete blocker. */
  needs?: string;
}

export type CirclePermissionKey =
  | "profile_modules"
  | "filter"
  | "story_audience"
  | "post_audience"
  | "message_broadcast"
  | "feed_priority";

export const CIRCLE_PERMISSIONS: readonly CirclePermissionSpec[] = [
  {
    key: "filter",
    label: "Filter and sort",
    blurb: "Browse your connections by circle anywhere they're listed.",
    live: true,
  },
  {
    key: "profile_modules",
    label: "Profile sections",
    blurb: "Show a profile section to this circle only.",
    live: true,
  },
  {
    key: "story_audience",
    label: "Story audience",
    blurb: "Post a story to this circle only.",
    live: false,
    needs: "Stories resolve their audience from friendship/following at read time; there is no per-story audience column to hold a circle.",
  },
  {
    key: "post_audience",
    label: "Post audience",
    blurb: "Publish a post to this circle only.",
    live: false,
    needs: "`posts.visibility` is a CHECK constraint that the feed indexes and the row-level read policy both depend on. Widening it safely is a migration plus a policy rewrite, not a picker.",
  },
  {
    key: "message_broadcast",
    label: "Message the circle",
    blurb: "Start one conversation with everyone in it.",
    live: false,
    needs: "Group conversations exist, but nothing keeps a circle and a conversation's membership in step when someone is added or removed.",
  },
  {
    key: "feed_priority",
    label: "Feed priority",
    blurb: "See this circle higher in your feed.",
    live: false,
    needs: "The ranker reads a mutual-friend signal, not circle membership. Adding a per-circle weight means re-tuning the ranking, which needs measurement first.",
  },
] as const;

export function circlePermission(key: string): CirclePermissionSpec | undefined {
  return CIRCLE_PERMISSIONS.find((p) => p.key === key);
}

export function liveCirclePermissions(): CirclePermissionSpec[] {
  return CIRCLE_PERMISSIONS.filter((p) => p.live);
}

// ── Palette ───────────────────────────────────────────────────────────────

export type CircleColor = "blue" | "violet" | "emerald" | "amber" | "rose" | "sky" | "pink" | "slate";

export const CIRCLE_COLORS: readonly CircleColor[] = [
  "blue",
  "violet",
  "emerald",
  "amber",
  "rose",
  "sky",
  "pink",
  "slate",
] as const;

export const DEFAULT_CIRCLE_COLOR: CircleColor = "blue";

export function isCircleColor(value: unknown): value is CircleColor {
  return typeof value === "string" && (CIRCLE_COLORS as readonly string[]).includes(value);
}

/** Tailwind classes per palette key — the ONLY place a circle colour becomes CSS. */
export function circleColorClasses(color: string): { chip: string; dot: string; ring: string } {
  const map: Record<CircleColor, { chip: string; dot: string; ring: string }> = {
    blue: { chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500", ring: "ring-blue-500/30" },
    violet: {
      chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      dot: "bg-violet-500",
      ring: "ring-violet-500/30",
    },
    emerald: {
      chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
      ring: "ring-emerald-500/30",
    },
    amber: {
      chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
      ring: "ring-amber-500/30",
    },
    rose: { chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400", dot: "bg-rose-500", ring: "ring-rose-500/30" },
    sky: { chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400", dot: "bg-sky-500", ring: "ring-sky-500/30" },
    pink: { chip: "bg-pink-500/10 text-pink-600 dark:text-pink-400", dot: "bg-pink-500", ring: "ring-pink-500/30" },
    slate: {
      chip: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
      dot: "bg-slate-500",
      ring: "ring-slate-500/30",
    },
  };
  return map[isCircleColor(color) ? color : DEFAULT_CIRCLE_COLOR];
}

// ── Limits ────────────────────────────────────────────────────────────────

/**
 * Caps exist so one member cannot make their own circle list unusable, and so
 * a circle-aware read stays a bounded `in (...)` rather than an unbounded one.
 */
export const MAX_CIRCLES_PER_MEMBER = 50;
export const MAX_MEMBERS_PER_CIRCLE = 500;
export const MAX_CIRCLE_NAME_LENGTH = 32;

export type CircleNameResult = { ok: true; value: string } | { ok: false; error: string };

export function validateCircleName(raw: string, existingNames: readonly string[] = []): CircleNameResult {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return { ok: false, error: "Give the circle a name." };
  if (cleaned.length > MAX_CIRCLE_NAME_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_CIRCLE_NAME_LENGTH} characters.` };
  }
  const lowered = cleaned.toLowerCase();
  if (existingNames.some((n) => n.trim().toLowerCase() === lowered)) {
    return { ok: false, error: "You already have a circle with that name." };
  }
  return { ok: true, value: cleaned };
}

// ── Suggested circles ─────────────────────────────────────────────────────

/**
 * Starting points, NOT auto-created. A brand-new member arriving to eleven
 * empty circles has been given eleven chores; the list is offered as one-tap
 * suggestions next to "New circle" and nothing exists until they tap.
 */
export const SUGGESTED_CIRCLES: readonly { name: string; color: CircleColor }[] = [
  { name: "Inner Circle", color: "violet" },
  { name: "Close Friends", color: "emerald" },
  { name: "Family", color: "rose" },
  { name: "Work", color: "blue" },
  { name: "School", color: "sky" },
  { name: "Gaming Squad", color: "pink" },
  { name: "Photography", color: "amber" },
  { name: "Travel", color: "sky" },
  { name: "Business Team", color: "slate" },
  { name: "Study Group", color: "emerald" },
  { name: "Creator Team", color: "violet" },
  { name: "VIP", color: "amber" },
] as const;

// ── Audience integration ──────────────────────────────────────────────────

/**
 * A module audience naming one circle, stored as `circle:<uuid>`.
 *
 * A string rather than a join table because `profile_modules.audience` is
 * already a text column that the engine reads: this rides the existing gate
 * instead of adding a second one that some future caller forgets to apply.
 */
export const CIRCLE_AUDIENCE_PREFIX = "circle:";

export function circleAudience(circleId: string): string {
  return `${CIRCLE_AUDIENCE_PREFIX}${circleId}`;
}

/** The circle id inside a `circle:<uuid>` audience, or null if it isn't one. */
export function circleAudienceId(audience: string | null | undefined): string | null {
  if (!audience || !audience.startsWith(CIRCLE_AUDIENCE_PREFIX)) return null;
  const id = audience.slice(CIRCLE_AUDIENCE_PREFIX.length).trim();
  // Must look like a uuid — anything else is a malformed row, and a malformed
  // audience has to fail CLOSED (nobody sees it) rather than open.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function isCircleAudience(audience: string | null | undefined): boolean {
  return !!audience && audience.startsWith(CIRCLE_AUDIENCE_PREFIX);
}
