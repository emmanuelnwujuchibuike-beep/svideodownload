"use client";

import { useEffect, useRef } from "react";

import type { StoryGroup } from "@/lib/social/stories";

/**
 * `?story=<id>` in the address opens that one story (2026-10-26) — where a "Frenz Coin for your story" notification
 * lands, and where Back returns to from the coin transfer opened inside a story. Read once the rings hold it, then
 * dropped from the address so a refresh does not reopen it. An ended story says so instead of opening another.
 * Shared by Home/Messages (stories-row.tsx) and the Friends page (friends-stories.tsx).
 */
export function useStoryDeepLink(groups: StoryGroup[] | undefined, open: (groupIndex: number, storyId: string) => void): void {
  const wanted = useRef<string | null | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (wanted.current === undefined) wanted.current = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("story");
    const id = wanted.current;
    if (!id || groups === undefined) return;
    wanted.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("story");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const gi = groups.findIndex((g) => g.stories.some((s) => s.id === id));
    if (gi === -1) {
      void import("@/features/ui/toast").then(({ toast }) => toast("That story has ended.", "info"));
      return;
    }
    openRef.current(gi, id);
  }, [groups]);
}
