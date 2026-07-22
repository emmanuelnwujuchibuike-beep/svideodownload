/**
 * Wires the domain event bus into observability: every emitted event is metered.
 * Installed once at server startup from `instrumentation.ts` (Next's standard hook),
 * so it costs nothing on the request hot path and needs no per-call instrumentation.
 *
 * This is the concrete second consumer that makes the event bus' `observeEvents`
 * seam real: the producer emits, and observability subscribes, neither knowing the
 * other — exactly the loose coupling the event platform exists for.
 */
import { observeEvents } from "@/lib/platform/event-bus";

import { increment } from "./trace";

let installed = false;

/** Meter every domain event as `event.<id>`. Idempotent; returns an uninstaller. */
export function installEventTracing(): () => void {
  if (installed) return () => {};
  installed = true;
  const off = observeEvents((event) => increment(`event.${event}`));
  return () => {
    installed = false;
    off();
  };
}
