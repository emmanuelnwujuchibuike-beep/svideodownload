"use client";

import { CircleDashed } from "lucide-react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { StoriesRow } from "@/features/app-shell/dashboard/stories-row";

/**
 * The stories strip on /messages.
 *
 * This is a FEATURE, not a fix. The long-running report "the stories section in
 * Messages doesn't show in any account" was investigated against the production
 * DB and had two non-bug causes: there were genuinely zero unexpired stories at
 * the time, and — the real point — Messages never had a stories row at all.
 * `StoriesRow` was mounted only on /home and /friends. What people were looking
 * at in the inbox is the PINNED CHATS strip, which wears story-style gradient
 * rings and is routinely mistaken for stories.
 *
 * That mistake is exactly why this carries its own uppercase "STORIES" eyebrow,
 * matching the treatment the Pinned strip already uses. Two circle strips
 * stacked with no labels would have made the original confusion worse, not
 * better — the label is what makes them read as two different things.
 *
 * Deliberately client-only, so it costs the inbox shell nothing and can't drag
 * the header back behind a suspense boundary (see the page's note on why the
 * shell must stay synchronous):
 *   - the story groups come from `useQuery("stories")` — the SAME shared cache
 *     key /home uses, so arriving from Home paints them instantly and only
 *     revalidates in the background;
 *   - the viewer's own handle/avatar come from `useEntitlements`, which is
 *     seeded from the identity cache and so is available on the first frame
 *     even on a cold PWA start.
 */
export function InboxStoriesRow() {
  const { handle, avatarUrl } = useEntitlements();

  return (
    <section aria-label="Stories" className="mb-1">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
          <CircleDashed className="h-3 w-3" /> Stories
        </span>
      </div>
      {/* No `initialGroups`: this surface has no server data by design, so the
          row seeds from the shared client cache and fetches /api/stories itself.
          "Your story" always shows even with nothing to watch — it's the entry
          point for posting one. */}
      <StoriesRow viewerAvatarUrl={avatarUrl} viewerName={handle ?? undefined} viewerHandle={handle} />
    </section>
  );
}
