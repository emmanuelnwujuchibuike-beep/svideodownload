/**
 * Visitor Adaptive Experience™ — who is looking, and what that entitles them to
 * (Feature 18 · Part 14).
 *
 * ── Roles are DERIVED, never declared ─────────────────────────────────────
 * A viewer does not pick a role. The platform already knows the relationship —
 * ownership, admin, friendship, follow, signed-in — and the role falls out of
 * it. That matters for privacy: a module gated to "Friends" is gated by the
 * friendship table, not by a claim in a request.
 *
 * ── Why only these five ───────────────────────────────────────────────────
 * The brief also names Subscriber, Customer, Recruiter and Business Partner.
 * Three of those are not knowable today and one is not knowable at all:
 *
 *   · Subscriber — needs recurring creator billing (the commerce platform
 *     bills one-off payments; there is no subscription edge to read).
 *   · Customer   — needs an order table linking a buyer to this seller.
 *   · Recruiter / Business Partner — is not a relationship the platform can
 *     observe at all. It is a viewer's INTENT. Guessing it would mean showing
 *     a stranger a different profile based on a hunch.
 *
 * So intent is served the honest way instead: the OWNER decides what a
 * stranger lands on (`landing_module`), which is exactly the "recruiter sees
 * the portfolio" outcome — chosen by the person whose profile it is, not
 * inferred about the person reading it. `subscriber` and `customer` are typed
 * here so the day those tables exist the resolver gains a branch, not a
 * rewrite.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import { circleAudienceId } from "@/lib/social/graph/circles";

/** Derived, in ascending order of access. */
export type ViewerRole =
  | "anon" // not signed in
  | "member" // signed in, no relationship
  | "follower" // follows this profile
  | "friend" // mutual friendship
  | "admin" // platform staff
  | "owner"; // it's their own profile

export interface ViewerContext {
  viewerId: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isFriend: boolean;
  isFollowing: boolean;
}

/**
 * The single role that describes this viewer. Highest wins: an admin who also
 * follows you is an admin; you are always the owner of your own profile.
 */
export function resolveViewerRole(ctx: ViewerContext): ViewerRole {
  if (ctx.isOwner) return "owner";
  if (ctx.isAdmin) return "admin";
  if (ctx.isFriend) return "friend";
  if (ctx.isFollowing) return "follower";
  if (ctx.viewerId) return "member";
  return "anon";
}

/** What the viewer brings beyond their role — currently their circle membership. */
export interface AudienceContext {
  /**
   * Ids of the PROFILE OWNER's circles this viewer belongs to. Ids only: the
   * viewer must never learn a circle's name from a visibility check (see
   * `lib/social/graph/store.ts`).
   */
  viewerCircles?: ReadonlySet<string>;
}

/**
 * Can `role` see a module gated at `audience`?
 *
 * Owner always can — a member can never lock themselves out of their own
 * profile. Admin is deliberately NOT granted access to `private` modules: a
 * moderator needs to see what a profile PUBLISHES, not what its owner kept to
 * themselves. Anything stricter than public is invisible to them too, except
 * where their moderation tools (a separate surface, with its own audit trail)
 * grant it explicitly.
 *
 * `audience` is typed as a plain string because a Social Circle audience
 * (Part 17) is stored as `circle:<uuid>` — an open set that no union type can
 * enumerate. Everything unrecognised still falls through to `default: false`,
 * so a malformed audience hides the module rather than exposing it.
 */
export function canSeeModule(role: ViewerRole, audience: string, ctx?: AudienceContext): boolean {
  if (role === "owner") return true;

  // Circle-gated: membership of that exact circle, and nothing else. Admins are
  // excluded for the same reason they are excluded from `private` — a circle is
  // a member's own decision about who is close to them, not published content.
  const circleId = circleAudienceId(audience);
  if (circleId) return ctx?.viewerCircles?.has(circleId) === true;
  // A `circle:` audience that failed to parse is malformed, not permissive.
  if (audience.startsWith("circle:")) return false;

  switch (audience) {
    case "public":
      return true;
    case "member":
      return role !== "anon";
    case "follower":
      return role === "follower" || role === "friend";
    case "friend":
      return role === "friend";
    case "private":
      return false;
    default:
      return false;
  }
}

/** A short, human label for the role — used in the owner's own preview. */
export function roleLabel(role: ViewerRole): string {
  switch (role) {
    case "owner":
      return "You";
    case "admin":
      return "Moderator";
    case "friend":
      return "Friend";
    case "follower":
      return "Follower";
    case "member":
      return "Signed-in member";
    default:
      return "Anyone";
  }
}

/**
 * The roles a member can PREVIEW their own profile as. Ordered widest-first,
 * because the question a member actually asks is "what does a stranger see?".
 * Owner and admin are excluded: previewing yourself as yourself is the page
 * you are already on, and nobody may preview as staff.
 */
export const PREVIEWABLE_ROLES: ViewerRole[] = ["anon", "member", "follower", "friend"];

export function isPreviewableRole(value: string): value is ViewerRole {
  return (PREVIEWABLE_ROLES as string[]).includes(value);
}
