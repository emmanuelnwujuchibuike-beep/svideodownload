/**
 * The viewer's own reactions this session, by post (owner, 2026-10-28: "if I like a post in the feed, navigate to a
 * different page and come back, it shows I haven't liked it — even though the creator got the like notification").
 *
 * The like WAS saved; the card simply re-mounted from a cached feed page (the shared cache / router cache) that was
 * read before the tap, and seeded itself from that stale `viewerLiked`. Every reaction the viewer makes is remembered
 * here, and a card prefers it over what a cached page says. The server stays the source of truth: a fresh read that
 * agrees changes nothing, and a reload (a new session) reads only the server.
 */
export interface RememberedReaction {
  liked?: boolean;
  saved?: boolean;
  emotion?: string | null;
  likes?: number;
}

const memory = new Map<string, RememberedReaction>();
const LIMIT = 500;

export function rememberReaction(postId: string, patch: RememberedReaction): void {
  const next = { ...memory.get(postId), ...patch };
  memory.delete(postId);
  memory.set(postId, next);
  if (memory.size > LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
}

export function rememberedReaction(postId: string): RememberedReaction | undefined {
  return memory.get(postId);
}
