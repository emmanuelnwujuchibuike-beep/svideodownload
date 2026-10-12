import type { NotificationType } from "@/lib/platform/notifications-registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SMART ACTION ENGINE — which actions a notification offers (Feature 20 Part 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The brief: "Message → Reply, Mark read, Mute; Friend request → Accept, Decline,
 * View profile, Block…". This is that table, as rules over what the notification
 * IS — not a model, and never an action whose endpoint doesn't exist. Every id
 * below maps to a real call the card already makes or a link that already works:
 *
 *   reply         POST /api/messages (idempotent clientId) — one-to-one and group chats
 *   accept/decline POST /api/friends/{actor}
 *   follow_back   POST /api/follow/{actor}
 *   block         POST /api/block/{actor} (also ends SUB access — sub_capture)
 *   ignore        deletes the alert
 *   view_profile  /u/{handle}
 *   open          the notification's own destination
 *
 * Single-actor only for person actions: on a grouped card ("Ana and 4 others")
 * it isn't clear who to accept, so the group just opens.
 */
export type SmartActionId = "reply" | "accept" | "decline" | "follow_back" | "block" | "ignore" | "view_profile" | "open";

export interface SmartActionInput {
  type: NotificationType;
  totalActors: number;
  hasActor: boolean;
  conversationId: string | null;
  /** the push went to a secret (end-to-end) chat — the server can't send for the member there */
  secretChat?: boolean;
}

export function actionsFor(n: SmartActionInput): SmartActionId[] {
  const single = n.totalActors === 1 && n.hasActor;
  switch (n.type) {
    case "message":
    case "message_mention":
      return n.conversationId && !n.secretChat ? ["reply", "open"] : ["open"];
    case "friend_request":
      return single ? ["accept", "decline", "view_profile"] : ["open"];
    case "follow":
      return single ? ["follow_back", "view_profile"] : ["open"];
    case "sub_capture":
      return single ? ["block", "ignore"] : ["open"];
    case "friend_accepted":
    case "member_joined":
      return single ? ["view_profile", "open"] : ["open"];
    default:
      return ["open"];
  }
}

/** Plain words for each action — the button label and its accessible name. */
export const ACTION_LABEL: Record<SmartActionId, string> = {
  reply: "Reply",
  accept: "Accept",
  decline: "Decline",
  follow_back: "Follow back",
  block: "Block",
  ignore: "Ignore",
  view_profile: "View profile",
  open: "Open",
};
