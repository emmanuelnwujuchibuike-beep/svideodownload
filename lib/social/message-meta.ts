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

/**
 * @handle mention detection — the SAME character class/shape as the existing
 * comment-mention trigger (migration 0037's `notify_on_comment_mention`) and
 * `components/social/rich-text.tsx`'s render-time linkifier, so a mention
 * notifies exactly the people it renders as a clickable link for, one source
 * of truth across comments, chat, and display.
 */
const MENTION_RE = /@([A-Za-z0-9_.]+)/g;

/** Lowercased, trailing-dot-trimmed handles mentioned in `body` (deduped). */
export function parseMentionedHandles(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const handle = m[1]!.replace(/\.+$/, "").toLowerCase();
    if (handle) out.add(handle);
  }
  return [...out];
}
