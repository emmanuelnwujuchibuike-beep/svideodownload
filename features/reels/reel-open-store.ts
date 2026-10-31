/**
 * Open a video in the Reels deck IN PLACE, over the page you're on (owner, 2026-10-31: "the reels reload each time I
 * enter a video"). A video tile used to navigate to /reels?start=<id>; every new id is a new URL, so the app asked the
 * server for a whole Reels page and showed the black loading screen each time. Now a plain tap hands the id to the
 * host (features/reels/in-place-reel-host.tsx, in the signed-in shell's deferred island), which fetches that ONE item
 * and opens the same deck the home feed opens in place.
 *
 * A module store, so it costs a tile nothing: no React context, no import of the deck. A tap before the host has
 * mounted (or on a tree without one) returns false and the link navigates as before — never a dead tap.
 */

type Opener = (id: string) => void;
let opener: Opener | null = null;

/** The host registers itself; returns the unregister. */
export function setReelOpener(fn: Opener): () => void {
  opener = fn;
  return () => {
    if (opener === fn) opener = null;
  };
}

/** True when the deck will open in place; false = let the link navigate. */
export function openReelInPlace(id: string): boolean {
  if (!opener) return false;
  opener(id);
  return true;
}

const START = /^\/reels\?start=([0-9a-f-]{36})(?:&|$)/i;

/** The post id of a `/reels?start=<id>` link (lib/social/post-url.ts reelsViewHref), else null. */
export function reelStartId(href: string): string | null {
  return START.exec(href)?.[1] ?? null;
}
