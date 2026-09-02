/**
 * Collaboration shapes — the PURE half (Feature 15 · Part 9).
 *
 * 🔴 CLIENT-SAFE. No Supabase, no `server-only`, no I/O.
 * See `./plan-kinds.ts` for why this split exists at all.
 */

export type CollabRole = "collaborator" | "co_author";
export type CollabStatus = "pending" | "accepted" | "declined";

export interface Collaborator {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: CollabRole;
  status: CollabStatus;
  createdAt: string;
}

/**
 * An invite as seen by its RECIPIENT — deliberately not a `Collaborator`.
 * On your own invite list, your own handle and avatar say nothing; what matters
 * is which post it is and who asked.
 */
export interface CollabInvite {
  postId: string;
  postTitle: string;
  postThumbnailUrl: string | null;
  role: CollabRole;
  status: CollabStatus;
  createdAt: string;
  invitedByHandle: string | null;
}
