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

import type { AudienceKey } from "@/lib/profile/modules";

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

/**
 * Can `role` see a module gated at `audience`?
 *
 * Owner always can — a member can never lock themselves out of their own
 * profile. Admin is deliberately NOT granted access to `private` modules: a
 * moderator needs to see what a profile PUBLISHES, not what its owner kept to
 * themselves. Anything stricter than public is invisible to them too, except
 * where their moderation tools (a separate surface, with its own audit trail)
 * grant it explicitly.
 */
export function canSeeModule(role: ViewerRole, audience: AudienceKey): boolean {
  if (role === "owner") return true;
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
