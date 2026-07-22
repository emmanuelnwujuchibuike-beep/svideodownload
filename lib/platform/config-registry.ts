/**
 * Configuration Registry — every runtime-configurable surface in one catalogue.
 *
 * The brief's "Configuration Registry™": what can change WITHOUT a release, where
 * its value lives, and at what scope. It's a catalogue over the real config systems
 * (flags, experiments, plan limits, settings, per-user prefs), kept honest by
 * `config-registry.test.ts` — a `live` surface must point at a file that exists, and
 * the things the brief lists that we don't run yet (approval workflow, region/device
 * targeting, native remote-config) are `planned`, not fabricated.
 */

export type ConfigKind =
  | "feature-flag"
  | "experiment"
  | "runtime-policy"
  | "settings"
  | "personalization"
  | "governance";

export type ConfigScope = "global" | "per-plan" | "per-user" | "per-request";
export type ConfigStatus = "live" | "planned";

export interface ConfigSurface {
  id: string;
  name: string;
  kind: ConfigKind;
  scope: ConfigScope;
  governs: string;
  /** Repo-relative source. Empty only when `planned`. */
  source: string;
  /** Where the runtime value is stored. */
  storage: string;
  status: ConfigStatus;
  note?: string;
}

export const CONFIG_SURFACES: ConfigSurface[] = [
  { id: "feature-flags", name: "Feature flags", kind: "feature-flag", scope: "per-user", governs: "Boolean toggles, % rollouts, plan gates, kill switches, schedule, dependencies.", source: "lib/platform/flags.ts", storage: "feature_flags table", status: "live" },
  { id: "experiments", name: "Experiments", kind: "experiment", scope: "per-user", governs: "A/B variant assignment, pause, ship-the-winner.", source: "lib/platform/experiments.ts", storage: "experiments table", status: "live" },
  { id: "plan-limits", name: "Plan limits & rate policy", kind: "runtime-policy", scope: "per-plan", governs: "Daily download caps, API rate limits, batch/ads entitlements per plan.", source: "lib/monetization/plan.ts", storage: "settings table (plan_limits)", status: "live" },
  { id: "monetization", name: "Monetization switches", kind: "settings", scope: "global", governs: "Ad networks, affiliates, interstitials, publisher id, ads.txt.", source: "lib/monetization/settings.ts", storage: "settings table (monetization)", status: "live" },
  { id: "notification-settings", name: "Notification preferences", kind: "personalization", scope: "per-user", governs: "Per-category in-app/push, quiet hours, digest.", source: "lib/social/notification-settings.ts", storage: "notification_settings table", status: "live" },
  { id: "home-preferences", name: "Home personalization", kind: "personalization", scope: "per-user", governs: "Feed/home surface preferences.", source: "lib/social/home-preferences.ts", storage: "user_home_preferences table", status: "live" },
  { id: "config-history", name: "Config change history", kind: "governance", scope: "global", governs: "Version history + audit + rollback source for flag/experiment changes.", source: "lib/platform/config-audit.ts", storage: "config_audit_log table", status: "live" },

  /* ── named by the brief, honestly not built ── */
  { id: "approval-workflow", name: "Change approval workflow", kind: "governance", scope: "global", governs: "Reviewer sign-off before a config change applies.", source: "", storage: "", status: "planned", note: "Changes are audited + reversible today; a gated approval step is deferred (single-operator scale)." },
  { id: "geo-device-targeting", name: "Region / device targeting", kind: "feature-flag", scope: "per-request", governs: "Roll out by country or device class.", source: "", storage: "", status: "planned", note: "Flags target plan + deterministic % + schedule + dependency today; geo/device needs a request-context signal (edge geo)." },
  { id: "native-remote-config", name: "Native app remote config", kind: "settings", scope: "global", governs: "Runtime config for native iOS/Android.", source: "", storage: "", status: "planned", note: "No native apps in this repo (Next.js PWA). The SDK + /api/flags already serve any client that exists." },
];

export function getConfigSurfaces(): ConfigSurface[] {
  return CONFIG_SURFACES;
}
