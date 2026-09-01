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
  /*
    Multi-Link batch lifecycle (owner, 2026-08-25: "see in live activity which
    user used multi links"). All three, because the feed has to answer both
    halves of the question — a batch that RAN and a batch that was REFUSED are
    equally worth seeing, and a feed showing only successes makes a limit that
    is biting look like quiet demand.
  */
  // Bottom/history banner lifecycle — see events-registry.ts.
  "banner_filled",
  "banner_empty",
  "banner_click",
  "interstitial_filled",
  "interstitial_empty",
  "interstitial_click",
  "batch_authorized",
  "batch_started",
  "batch_refused",
  "subscribe",
  "subscribe_cancel",
  "api_key_created",
  "upgrade_prompt_view",
  "pwa_installed",
]);

/** What each ExoClick display placement is called in the admin. */
const SLOT_LABELS: Record<string, string> = {
  bottomnav: "Bottom banner",
  history: "History banner",
  historyfeed: "History in-feed",
  landing: "Landing banner",
  sticky: "Sticky banner",
  interstitial: "Full-page interstitial",
};

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
    /*
      The PLACEMENT and the PAGE, because "the banner did not show" is always
      about a particular one of each.

      🔴 The placement is named the way the OPERATOR names it, not the way the
      code does (owner, 2026-08-31: "it is showing bottom NAV fill, i didnt ask
      for that, i said bottom banner activity not bottom NAV"). `bottomnav` is
      an internal slot id; the thing it renders is the Bottom banner, which is
      also what it is called in the admin. A feed that reads back the source
      code makes the operator translate it.
    */
    case "banner_filled":
    case "banner_empty":
    case "banner_click":
    case "interstitial_filled":
    case "interstitial_empty":
    case "interstitial_click": {
      const slot = m.slot ? SLOT_LABELS[String(m.slot)] ?? String(m.slot) : null;
      const path = m.path ? String(m.path) : null;
      return [slot, path].filter(Boolean).join(" · ") || null;
    }
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
    case "batch_authorized": {
      // "3 sources · 16 items · free" — the shape of the batch, which is what
      // an operator is scanning the feed for.
      const sources = typeof m.sources === "number" ? m.sources : null;
      const items = typeof m.items === "number" ? m.items : null;
      const parts = [
        sources !== null ? `${sources} source${sources === 1 ? "" : "s"}` : null,
        items !== null ? `${items} item${items === 1 ? "" : "s"}` : null,
        m.plan ? String(m.plan) : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "batch_refused":
      // WHICH limit bit. Without it the feed says a batch failed and leaves the
      // operator to guess between a spent allowance and a source ceiling.
      return m.reason ? String(m.reason).toLowerCase().replace(/_/g, " ") : null;
    case "batch_started":
      return m.allowed === false ? "allowance already spent" : "downloading";
    case "upgrade_prompt_view":
      return m.kind ? String(m.kind) : null;
    default:
      return null;
  }
}
