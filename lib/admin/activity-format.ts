import { getEvents } from "@/lib/platform/events-registry";

/**
 * Pure formatting for the admin activity feed — split out of `activity.ts` (which
 * is `server-only`) so the label/detail logic is unit-testable.
 */

/** Event types worth showing in the operator feed. `api_call`/`experiment_exposure`
 *  would flood it — widen this set deliberately.
 *
 *  `download` is intentionally ABSENT: downloads are rendered from the canonical
 *  `downloads` table (see activity.ts). Including the event type too would render
 *  the same download twice — once as `e:<id>` and once as `d:<id>` — which the
 *  id-based dedup can't catch because the ids differ. That was the duplicate
 *  activity the operator reported. */
export const NOTABLE = new Set([
  "ad_click",
  "ad_impression",
  "affiliate_click",
  // Rewarded-ad lifecycle (owner, 2026-08-23: "reward ad watched … wired in
  // the admin dashboard in live activity"). Both halves are listed on
  // purpose — see the note in lib/platform/events-registry.ts for why the
  // started/granted pair is what makes the feed answer "do rewarded ads
  // actually complete?" rather than just "a reward existed".
  "reward_started",
  "reward_granted",
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
    case "reward_started":
    case "reward_granted": {
      // "video · 3 items" — the reward TYPE is what an operator is scanning
      // for (is it the HD-video reward or the batch one that people finish?),
      // and the count says how much a single completed watch unlocked.
      const type = m.rewardType ? String(m.rewardType) : null;
      const count = typeof m.items === "number" ? m.items : null;
      const parts = [type, count !== null ? `${count} item${count === 1 ? "" : "s"}` : null].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "upgrade_prompt_view":
      return m.kind ? String(m.kind) : null;
    default:
      return null;
  }
}
