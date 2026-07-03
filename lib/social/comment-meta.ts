/**
 * Comment reaction set + mood tags. Curated for a premium, performant quick-react
 * bar (no heavy emoji keyboard). Ids/emoji are validated on write so we never
 * store arbitrary values.
 */

/** Quick reactions, in display order. One reaction per user per comment. */
export const COMMENT_REACTIONS = ["❤️", "👍", "🔥", "😂", "👏", "😮", "😢", "🎉"] as const;
export type CommentReaction = (typeof COMMENT_REACTIONS)[number];

const REACTION_SET = new Set<string>(COMMENT_REACTIONS);
export function isCommentReaction(e: string): boolean {
  return REACTION_SET.has(e);
}

export interface CommentMood {
  id: string;
  label: string;
  emoji: string;
  /** Tailwind text/border tint for the pill. */
  tint: string;
}

export const COMMENT_MOODS: CommentMood[] = [
  { id: "question", label: "Question", emoji: "❓", tint: "text-blue-500 border-blue-500/30 bg-blue-500/10" },
  { id: "opinion", label: "Opinion", emoji: "💭", tint: "text-violet-500 border-violet-500/30 bg-violet-500/10" },
  { id: "tip", label: "Tip", emoji: "💡", tint: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
  { id: "news", label: "News", emoji: "📰", tint: "text-cyan-500 border-cyan-500/30 bg-cyan-500/10" },
  { id: "tutorial", label: "Tutorial", emoji: "🛠️", tint: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
  { id: "funny", label: "Funny", emoji: "😂", tint: "text-orange-500 border-orange-500/30 bg-orange-500/10" },
  { id: "feedback", label: "Feedback", emoji: "📝", tint: "text-indigo-500 border-indigo-500/30 bg-indigo-500/10" },
  { id: "announcement", label: "Announcement", emoji: "📣", tint: "text-rose-500 border-rose-500/30 bg-rose-500/10" },
];

const MOOD_BY_ID = new Map(COMMENT_MOODS.map((m) => [m.id, m]));
export function isCommentMood(id: string): boolean {
  return MOOD_BY_ID.has(id);
}
export function commentMood(id: string | null | undefined): CommentMood | null {
  if (!id) return null;
  return MOOD_BY_ID.get(id) ?? null;
}
