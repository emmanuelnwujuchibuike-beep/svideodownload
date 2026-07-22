import { getEvents } from "@/lib/platform/events-registry";

/**
 * Pure formatting for the admin activity feed — split out of `activity.ts` (which
 * is `server-only`) so the label/detail logic is unit-testable.
 */

/** Event types worth showing in the operator feed. `api_call`/`experiment_exposure`
 *  would flood it — widen this set deliberately. */
export const NOTABLE = new Set([
  "download",
  "ad_click",
  "ad_impression",
  "affiliate_click",
  "subscribe",
  "subscribe_cancel",
  "api_key_created",
  "upgrade_prompt_view",
  "pwa_installed",
]);

const EVENT_LABELS: Record<string, string> = Object.fromEntries(
  getEvents().map((e) => [e.id, e.label]),
);

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

/** A short human detail for an event, from its metadata. Pure. */
export function eventDetail(type: string, metadata: Record<string, unknown> | null): string | null {
  const m = metadata ?? {};
  switch (type) {
    case "ad_click":
    case "ad_impression":
      return m.zone ? String(m.zone) : null;
    case "subscribe":
    case "subscribe_cancel":
      return m.plan ? String(m.plan) : null;
    case "affiliate_click":
      return m.offerId ? String(m.offerId) : null;
    case "upgrade_prompt_view":
      return m.kind ? String(m.kind) : null;
    default:
      return null;
  }
}
