/**
 * The reshare RULES — pure data + pure predicates, no imports.
 *
 * Split out from `reshare.ts` on purpose: that module reaches for
 * `node:crypto`, the Supabase admin client and `sendMessage`, so a client
 * component importing the rules from there would drag the whole server data
 * layer into the browser bundle. Same split, same reason, as
 * `lib/social/chat-fonts.ts` vs the chat-appearance API schema.
 *
 * Both the sheet (what rows to show) and the server (what to allow) import
 * from HERE, so the owner's rule — a story goes "to their own stories or
 * private chat no where else" — is enforced from one definition rather than two
 * that can drift.
 */

/** Where a reshare came FROM. */
export type ReshareSource = "message" | "story";
/** Where a reshare is going TO. `chat` = forwarded into a private conversation. */
export type ReshareDestination = "post" | "reel" | "story" | "chat";

export const RESHARE_DESTINATIONS: readonly ReshareDestination[] = ["post", "reel", "story", "chat"] as const;

/**
 * The owner's rule, as data (2026-07-16).
 *
 * `story` deliberately CANNOT reach the feed or Reels — "to their own stories
 * or private chat no where else".
 *
 * `message` deliberately CANNOT reach another chat from here: forwarding
 * already exists as its own feature (`forward-sheet.tsx`), and duplicating it
 * under a second name would give two inconsistent paths for one action.
 */
export const ALLOWED_DESTINATIONS: Record<ReshareSource, readonly ReshareDestination[]> = {
  message: ["post", "reel", "story"],
  story: ["story", "chat"],
};

export function canReshareTo(source: ReshareSource, destination: ReshareDestination): boolean {
  return ALLOWED_DESTINATIONS[source].includes(destination);
}

/** Reels carry exactly one video — the same product rule the composer and
 *  /api/stories already enforce. */
export function isValidReelMedia(mediaKind: "image" | "video"): boolean {
  return mediaKind === "video";
}
