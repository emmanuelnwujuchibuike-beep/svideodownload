/**
 * Event bus — typed, in-process publish/subscribe over the Domain Event Registry.
 *
 * ── Why in-process, and why that is the right answer here ─────────────────────
 *
 * We run one deployable (docs/ARCHITECTURE.md): a modular monolith with no network
 * hops between modules. So the correct event bus is in-process dispatch — a
 * producer `emit`s, any subscriber `on`s, and neither knows the other. That gives
 * the real prize (loose coupling, a seam for a second consumer) with zero broker
 * latency or ops. A message broker (Kafka/SQS) is the documented EXIT PATH for when
 * a module leaves the monolith — it is deferred, not faked (Integration Registry
 * marks it `planned`).
 *
 * ── Contracts + safety ────────────────────────────────────────────────────────
 *
 * Typed against `DomainEventPayloads`, so `emit`/`on` can't disagree on shape.
 * Delivery is fire-and-forget and each handler is isolated: a subscriber that
 * throws (sync or async) never breaks `emit` or the other subscribers — a listener
 * failing must not fail the business action that produced the event.
 *
 * ── Observability ─────────────────────────────────────────────────────────────
 *
 * `observeEvents` taps every emit — wire it to persistence/tracing at the app edge
 * without coupling the bus to a database (kept dependency-light + unit-testable).
 */
import type { DomainEventId, PayloadOf } from "./domain-events";

type AnyHandler = (payload: unknown) => void | Promise<void>;
type Observer = (event: DomainEventId, payload: unknown) => void;

const handlers = new Map<DomainEventId, Set<AnyHandler>>();
const observers = new Set<Observer>();

/** Where an isolated handler/observer error goes. Overridable for observability. */
let onError: (event: DomainEventId, err: unknown) => void = (event, err) => {
  // Default: never throw, but don't be silent — a dropped event should be visible.
  console.error(`[event-bus] handler for "${event}" threw`, err);
};

export function setEventErrorHandler(fn: (event: DomainEventId, err: unknown) => void): void {
  onError = fn;
}

/** Subscribe to an event. Returns an unsubscribe function. */
export function on<K extends DomainEventId>(
  event: K,
  handler: (payload: PayloadOf<K>) => void | Promise<void>,
): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as AnyHandler);
  return () => {
    handlers.get(event)?.delete(handler as AnyHandler);
  };
}

/** Publish an event. Fire-and-forget; never throws; handlers are isolated. */
export function emit<K extends DomainEventId>(event: K, payload: PayloadOf<K>): void {
  for (const observe of observers) {
    try {
      observe(event, payload);
    } catch (err) {
      onError(event, err);
    }
  }
  const set = handlers.get(event);
  if (!set) return;
  // Snapshot so a handler that (un)subscribes during dispatch can't mutate the set.
  for (const handler of [...set]) {
    try {
      const result = handler(payload);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err) => onError(event, err));
      }
    } catch (err) {
      onError(event, err);
    }
  }
}

/** Tap every emitted event (observability/tracing). Returns an unsubscribe fn. */
export function observeEvents(observer: Observer): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/** How many subscribers an event has (admin/introspection). */
export function subscriberCount(event: DomainEventId): number {
  return handlers.get(event)?.size ?? 0;
}

/** Test-only: drop all subscribers and observers. */
export function __resetBus(): void {
  handlers.clear();
  observers.clear();
}
