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
  /*
    Rewarded-ad lifecycle (owner, 2026-08-23: "I want all impression, clicks,
    reward ad watched and all information … wired in the admin dashboard in
    live activity").

    TWO events, not one, because the gap between them is the only number that
    says whether rewarded ads actually work: `reward_started` is the moment a
    visitor chose to watch, `reward_granted` is the moment the server accepted
    the reward. Recording only the grant would make the funnel look perfect —
    every reward that exists completed, by definition — and hide every
    abandoned or failed watch, which is exactly the metric worth having.

    Emitted from the reward-session lifecycle (lib/monetization/reward-sessions.ts),
    NOT from the client: the client already reports "ad finished", and that claim
    is precisely what the server refuses to trust. These fire where the session
    row actually changes state.
  */
  { id: "reward_started", label: "Reward ad started", description: "A visitor opened a rewarded ad to unlock a download.", domain: "monetization", metadata: ["rewardType", "items"] },
  { id: "reward_granted", label: "Reward ad completed", description: "A rewarded ad was verified and the download authorized.", domain: "monetization", metadata: ["rewardType", "items"] },
  /*
    ExoClick DISPLAY banner lifecycle (owner, 2026-08-31: "wire the bottom
    banner ad activity to the admin live activity").

    TWO events, for the same reason the reward pair above is two: the question
    is not "did a banner exist" but "was one ASKED for and did one ARRIVE". The
    banner is reported as showing once and then never again, and from the
    outside a slot that was never served and a slot the network declined look
    identical — both are a blank space. `banner_empty` is the one that earns
    its place: it is the only record of the loader being asked and answering
    with nothing, carrying WHICH slot and WHICH page.

    Client-emitted, unavoidably: only the browser can see whether the network's
    own script put a creative in the placeholder. Fired once per state change
    per mount, never per frame.
  */
  { id: "banner_filled", label: "Banner filled", description: "An ExoClick display banner rendered a creative.", domain: "monetization", metadata: ["slot", "path"] },
  { id: "banner_empty", label: "Banner empty", description: "An ExoClick display banner was served but no creative arrived.", domain: "monetization", metadata: ["slot", "path"] },
  /*
    Multi-Link batch lifecycle, emitted SERVER-side from
    app/api/downloads/batch/* — the three moments where the server itself made
    a decision, which is the only part of the flow worth auditing.

    `batch_refused` is the one that earns its place: it is the only record of a
    limit actually biting (daily allowance spent, source ceiling exceeded,
    feature switched off), carrying WHICH limit in `reason`. Without it the
    admin can see batches that ran and has no way to tell a quiet feature from
    one that is refusing everybody. The client-side funnel (panel opened,
    source added, post selected…) stays in the client analytics types, where
    the rest of the UI funnel already lives.
  */
  { id: "batch_authorized", label: "Batch authorized", description: "A multi-link batch passed the server-side plan and quota check.", domain: "download", metadata: ["sources", "items", "plan"] },
  { id: "batch_refused", label: "Batch refused", description: "A multi-link batch was refused by a server-side limit.", domain: "download", metadata: ["reason", "sources", "items"] },
  { id: "batch_started", label: "Batch started", description: "A multi-link batch spent its allowance and began downloading.", domain: "download", metadata: ["batchId", "allowed"] },
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
