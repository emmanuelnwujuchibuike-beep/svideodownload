/**
 * Event Registry — the declared catalogue of every analytics event the platform
 * emits. This is the brief's "Event Registry™", made real: one typed list that is
 * the single source of truth for `EventType`, so a new event is documented (label,
 * domain, metadata contract) at the moment it is added, and the union that
 * `trackEvent` accepts is *derived from* this list rather than maintained beside it.
 *
 * This is NOT an event BUS. Cross-module delivery is still direct calls + Supabase
 * realtime; a formal bus stays deferred until a genuine second consumer exists (see
 * docs/CONSTITUTION.md, Article VI). This registry is the naming/authoring plane.
 *
 * Events are written through `lib/analytics/events.ts` into the shared `events`
 * table (`type`, `user_id`, `metadata`).
 */

export type EventDomain =
  | "download"
  | "monetization"
  | "growth"
  | "api"
  | "experiment";

export interface EventDef {
  /** The `type` written to the events table. Stable, snake_case. Never reuse. */
  id: string;
  label: string;
  description: string;
  domain: EventDomain;
  /** Documented keys expected in `metadata` (the contract, for humans + review). */
  metadata?: readonly string[];
}

/**
 * `as const satisfies` gives us both: the literal ids survive (so `EventType` is a
 * precise union, not `string`), AND each entry is structurally checked against
 * `EventDef`. Adding an event here is the only way to make `trackEvent` accept it.
 */
export const EVENTS = [
  { id: "download", label: "Download", description: "A media download completed.", domain: "download", metadata: ["platform", "kind"] },
  { id: "ad_impression", label: "Ad impression", description: "An ad unit rendered.", domain: "monetization", metadata: ["zone", "adId"] },
  { id: "ad_click", label: "Ad click", description: "An ad unit was clicked.", domain: "monetization", metadata: ["zone", "adId"] },
  { id: "affiliate_click", label: "Affiliate click", description: "An affiliate offer was clicked.", domain: "monetization", metadata: ["offerId", "country", "device"] },
  { id: "subscribe", label: "Subscribe", description: "A paid subscription started.", domain: "monetization", metadata: ["plan"] },
  { id: "subscribe_cancel", label: "Subscription cancelled", description: "A paid subscription ended.", domain: "monetization", metadata: ["plan"] },
  { id: "api_call", label: "API call", description: "A developer-API request was served.", domain: "api" },
  { id: "api_key_created", label: "API key created", description: "A developer created an API key.", domain: "api" },
  { id: "upgrade_prompt_view", label: "Upgrade prompt view", description: "An upgrade prompt was shown.", domain: "growth" },
  { id: "pwa_install_prompt_shown", label: "Install prompt shown", description: "The PWA install prompt was shown.", domain: "growth" },
  { id: "pwa_install_accepted", label: "Install accepted", description: "The visitor accepted the install prompt.", domain: "growth" },
  { id: "pwa_install_dismissed", label: "Install dismissed", description: "The visitor dismissed the install prompt.", domain: "growth" },
  { id: "pwa_installed", label: "PWA installed", description: "The app was installed to the home screen.", domain: "growth" },
  { id: "experiment_exposure", label: "Experiment exposure", description: "An enrolled visitor was exposed to an experiment arm.", domain: "experiment", metadata: ["experiment", "variant"] },
] as const satisfies readonly EventDef[];

/** The union of every declared event id. `trackEvent` accepts exactly these. */
export type EventType = (typeof EVENTS)[number]["id"];

/** All declared events, in declaration order. */
export function getEvents(): readonly EventDef[] {
  return EVENTS;
}

/** One event definition by id. */
export function getEvent(id: EventType): EventDef | undefined {
  return EVENTS.find((e) => e.id === id);
}
