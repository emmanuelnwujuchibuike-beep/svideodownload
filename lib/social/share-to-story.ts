"use client";

import { toast } from "@/features/ui/toast";

/**
 * Put a feed post or reel on the viewer's own story (owner, 2026-10-14: "I want users to be
 * able to share feed and reels post to their story"). The server decides everything: the
 * post's own audience, blocks, and which album item (lib/social/reshare.ts `resolvePostMedia`).
 * Shared by the Share sheet's "Add to story" and the Repost sheet's "Repost to your story".
 */
export async function shareToStory(postId: string, mediaIndex = 0): Promise<boolean> {
  try {
    const res = await fetch("/api/reshare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "post", sourceId: postId, destination: "story", ...(mediaIndex > 0 ? { mediaIndex } : {}) }),
    });
    if (res.ok) {
      toast("Added to your story.", "success");
      return true;
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    toast(res.status === 401 ? "Sign in to add this to your story." : (j.error ?? "Couldn't add it to your story."), "error");
  } catch {
    toast("Couldn't add it to your story — check your connection.", "error");
  }
  return false;
}
