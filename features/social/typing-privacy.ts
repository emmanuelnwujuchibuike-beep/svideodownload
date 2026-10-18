/**
 * Who may join a messaging typing channel, decided on the client (owner, 2026-10-18).
 *
 * Ghost Mode is reciprocal (lib/privacy/ghost.ts marks typing `reciprocal`): a member
 * who hides their own typing neither sends nor SEES typing — in direct and group
 * chats, in the open thread and in the inbox. The hook in use-typing.ts already
 * treats an empty topic as "no channel", so hiding = joining nothing at all, which
 * is also the cheapest answer (no Presence traffic).
 *
 * Server side, `public.typing_topic_allowed` (0259) decides whether a join is
 * authorized at all — blocks, messaging restrictions, membership. This file only
 * decides whether the client asks.
 *
 * Dependency-free on purpose: block-options-sheet imports it, and pulling the
 * ~370-line use-typing module onto that sheet would be a cost for nothing.
 * Comment typing is NOT governed by this (owner: messaging Ghost Mode only).
 */

/** Inbox rows that may subscribe to typing (unchanged cap). */
export const INBOX_TYPING_ROWS = 25;

/** Fired after the server confirms a block or a messaging restriction from inside a chat. */
export const TYPING_REVOKED_EVENT = "frenz:typing-revoked";

export interface TypingRevokedDetail {
  conversationId: string;
}

/** The topic the open thread may join: none when the viewer hides typing, or access was just revoked here. */
export function roomTypingTopic(conversationId: string, typingEnabled: boolean, revoked: boolean): string {
  return typingEnabled && !revoked ? conversationId : "";
}

/**
 * Inbox rows subscribe only once the viewer's setting is KNOWN to be on. A device-cached
 * inbox painted before the first network load has no setting (`undefined`), and a hidden
 * member must never briefly receive typing — the refresh that always follows turns it on.
 */
export function rowSubscribesTyping(index: number, typingEnabled: boolean | undefined): boolean {
  return typingEnabled === true && index < INBOX_TYPING_ROWS;
}

/** Tell the open thread for `conversationId` to leave its typing channel now. */
export function announceTypingRevoked(conversationId: string): void {
  if (typeof window === "undefined" || !conversationId) return;
  window.dispatchEvent(new CustomEvent<TypingRevokedDetail>(TYPING_REVOKED_EVENT, { detail: { conversationId } }));
}
