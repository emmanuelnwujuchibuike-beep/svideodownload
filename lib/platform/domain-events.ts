/**
 * Domain Event Registry — the declared, typed contracts for the platform's
 * business events (UserCreated, MessageSent, …). The brief's "Event Platform" /
 * "Event Registry" for DOMAIN events, distinct from the analytics Event Registry
 * (`events-registry.ts`, which is the `trackEvent` funnel).
 *
 * This is the contract plane. `event-bus.ts` is the delivery: an in-process, typed
 * emit/subscribe over exactly these events. Today most of these fire as direct
 * function calls; declaring them here gives them a name, a payload contract, and a
 * seam a second consumer can subscribe to without the producer knowing — the whole
 * point of an event platform, sized honestly for a modular monolith (in-process
 * dispatch now; a broker is the documented exit path, not a thing we pretend to run).
 */

export type EventDomain =
  | "identity"
  | "social"
  | "messaging"
  | "media"
  | "downloads"
  | "monetization"
  | "moderation";

export interface DomainEventDef {
  /** Stable dot.case id, e.g. "message.sent". */
  id: string;
  name: string;
  description: string;
  domain: EventDomain;
  /** Documented payload keys — mirrors the typed contract in DomainEventPayloads. */
  payload: readonly string[];
}

export const DOMAIN_EVENTS = [
  { id: "user.created", name: "UserCreated", description: "A new account was created.", domain: "identity", payload: ["userId"] },
  { id: "session.started", name: "SessionStarted", description: "A user signed in on a device.", domain: "identity", payload: ["userId", "sessionId"] },
  { id: "follow.created", name: "FollowCreated", description: "One user followed another.", domain: "social", payload: ["followerId", "followeeId"] },
  { id: "post.published", name: "PostPublished", description: "A post/reel/story went live.", domain: "social", payload: ["postId", "authorId", "kind"] },
  { id: "comment.added", name: "CommentAdded", description: "A comment was added to a post.", domain: "social", payload: ["commentId", "postId", "authorId"] },
  { id: "reaction.added", name: "ReactionAdded", description: "A reaction was added to a post.", domain: "social", payload: ["postId", "actorId", "reaction"] },
  { id: "message.sent", name: "MessageSent", description: "A message was sent in a conversation.", domain: "messaging", payload: ["messageId", "conversationId", "senderId"] },
  { id: "download.completed", name: "DownloadCompleted", description: "A media download finished.", domain: "downloads", payload: ["platform", "userId"] },
  { id: "ad.clicked", name: "AdClicked", description: "A visitor clicked an ad unit.", domain: "monetization", payload: ["zone", "adId"] },
  { id: "media.processed", name: "MediaProcessed", description: "A worker finished transcoding media.", domain: "media", payload: ["streamUid", "postId"] },
  { id: "notification.delivered", name: "NotificationDelivered", description: "A notification was delivered to a channel.", domain: "notifications" as EventDomain, payload: ["userId", "channel"] },
  { id: "subscription.activated", name: "SubscriptionActivated", description: "A paid subscription became active.", domain: "monetization", payload: ["userId", "plan"] },
  { id: "content.reported", name: "ContentReported", description: "A user reported content or an account.", domain: "moderation", payload: ["targetId", "targetType", "reporterId"] },
] as const satisfies readonly DomainEventDef[];

/** The union of every declared domain-event id. */
export type DomainEventId = (typeof DOMAIN_EVENTS)[number]["id"];

/**
 * The compile-time payload contract, keyed by event id. The event bus is typed
 * against this, so a producer cannot emit the wrong shape and a subscriber gets a
 * fully-typed payload. Keep a key here for every id in DOMAIN_EVENTS.
 */
export interface DomainEventPayloads {
  "user.created": { userId: string };
  "session.started": { userId: string; sessionId: string };
  "follow.created": { followerId: string; followeeId: string };
  "post.published": { postId: string; authorId: string; kind: "post" | "reel" | "story" };
  "comment.added": { commentId: string; postId: string; authorId: string };
  "reaction.added": { postId: string; actorId: string; reaction: string };
  "message.sent": { messageId: string; conversationId: string; senderId: string };
  "download.completed": { platform: string; userId: string | null };
  "ad.clicked": { zone: string; adId: string | null };
  "media.processed": { streamUid: string; postId: string | null };
  "notification.delivered": { userId: string; channel: "push" | "in-app" };
  "subscription.activated": { userId: string; plan: string };
  "content.reported": { targetId: string; targetType: string; reporterId: string };
}

// Compile-time assertion: every declared id has a typed payload (and vice versa).
// If these ever disagree, this line fails to compile — the contract can't drift.
type _EveryIdHasPayload = DomainEventId extends keyof DomainEventPayloads ? true : never;
type _EveryPayloadHasId = keyof DomainEventPayloads extends DomainEventId ? true : never;
const _assertIdPayload: _EveryIdHasPayload = true;
const _assertPayloadId: _EveryPayloadHasId = true;
void _assertIdPayload;
void _assertPayloadId;

/** The payload type for a given event id. */
export type PayloadOf<K extends DomainEventId> = DomainEventPayloads[K];

export function getDomainEvents(): readonly DomainEventDef[] {
  return DOMAIN_EVENTS;
}

export function getDomainEvent(id: DomainEventId): DomainEventDef | undefined {
  return DOMAIN_EVENTS.find((e) => e.id === id);
}
