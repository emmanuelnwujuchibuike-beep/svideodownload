/**
 * Message reaction emoji set — reuses the comment system's curated set
 * rather than maintaining a second one; same premium quick-react bar,
 * same "one reaction per user" semantics.
 */
export { COMMENT_REACTIONS as MESSAGE_REACTIONS, isCommentReaction as isMessageReaction } from "./comment-meta";

/**
 * Group limits — kept client-safe (no Supabase import) so UI components can
 * reference them directly; lib/social/messages.ts (server-only, imports the
 * admin client) re-exports the same constants rather than redeclaring them.
 */
export const MAX_GROUP_MEMBERS = 50;
export const GROUP_TITLE_MAX = 80;
