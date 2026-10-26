import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN SENT FROM A STORY (owner, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "let users get a notification when someone gift them frenz coin through story
 * and the particular story" — the Story viewer's coin button opens the ordinary
 * transfer screen with `?to=<author>&story=<story id>`, the transfer request
 * carries the story id, and the recipient's notification says it was for that
 * story and opens it (`/home?story=<id>`).
 *
 * The story is a LABEL on a transfer, never part of the money: the transfer is
 * the same transfer_coins_with_pin call whatever this says, and the label is
 * checked only after it committed. It is honoured only when, at that moment:
 *
 *   · the story belongs to the member who received the coins,
 *   · it has not ended, and
 *   · the SENDER may see it (story_view_access, 0285/0287 — blocks, privacy).
 *
 * Anything else — a wrong id, an ended story, a story the sender could not see —
 * and the notification is the plain "You received Frenz Coin". Never throws.
 */

export interface StoryGift {
  storyId: string;
  /** the story's own picture: an image story, or a video's stored first frame */
  coverUrl: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveStoryGift(senderId: string, recipientId: string, storyId: string | null | undefined): Promise<StoryGift | null> {
  if (!storyId || !UUID.test(storyId) || !UUID.test(recipientId) || senderId === recipientId) return null;
  try {
    const db = createAdminClient();
    const [{ data: story }, { data: access, error }] = await Promise.all([
      db.from("stories").select("id, user_id, media_kind, media_url, thumbnail_url, expires_at").eq("id", storyId).maybeSingle(),
      db.rpc("story_view_access", { p_story: storyId, p_viewer: senderId }),
    ]);
    const s = story as { id: string; user_id: string; media_kind: string; media_url: string; thumbnail_url: string | null; expires_at: string } | null;
    if (error || access !== "ok" || !s || s.user_id !== recipientId) return null;
    if (!(Date.parse(s.expires_at) > Date.now())) return null;
    return { storyId: s.id, coverUrl: s.media_kind === "image" ? s.media_url : s.thumbnail_url };
  } catch {
    return null;
  }
}

/** Where the recipient's notification opens: their Home, with that story open (features/app-shell/dashboard/stories-row.tsx). */
export const storyGiftPath = (storyId: string) => `/home?story=${encodeURIComponent(storyId)}`;
