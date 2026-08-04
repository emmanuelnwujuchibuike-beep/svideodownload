/**
 * Adaptive Widget Platform™ (Feature 18 · Part 16, backed by migration 0110).
 *
 * A widget is a small, self-contained card on a profile. The catalogue works
 * exactly like `modules.ts` — declare everything, mark what is `live`, and say
 * what a `planned` one is waiting on — because the same honesty problem applies:
 * a grid of twelve beautiful widgets where four actually work is worse than four
 * that do.
 *
 * ── Where a widget's data comes from ──────────────────────────────────────
 * Most read signals this platform ALREADY has (achievements, reputation,
 * collections, offerings, events, goals). Those are live. The ones that need a
 * third party — a music service, a weather provider, a calendar — are declared
 * with `needs`, and cannot be enabled until that integration exists. They are
 * not stubs: `canEnableWidget` refuses them, so nothing can be switched on that
 * would render an empty box.
 *
 * ── `config` ──────────────────────────────────────────────────────────────
 * Self-contained widgets (a countdown, a quote) carry their own settings in
 * `profile_widgets.config`. The shape is declared here and validated by the API
 * against this registry — never trusted from the row, because a jsonb column is
 * whatever was last written to it.
 *
 * Pure: no React, no Supabase.
 */

export type WidgetKey =
  | "stats"
  | "achievements"
  | "trust"
  | "collections"
  | "downloads"
  | "portfolio"
  | "goals"
  | "countdown"
  | "quote"
  | "hours"
  | "events"
  | "store"
  | "spaces"
  | "music"
  | "weather"
  | "calendar"
  | "live";

export type WidgetField = "text" | "date" | "number";

export interface WidgetSpec {
  key: WidgetKey;
  label: string;
  blurb: string;
  icon: string;
  tint: string;
  status: "live" | "planned";
  /** For `planned`: the integration it waits on, in plain words. */
  needs?: string;
  /** Settings this widget stores in `config`. */
  fields?: { key: string; label: string; type: WidgetField; max?: number }[];
  /** Where its data comes from — documentation, and a hint for the renderer. */
  source: "derived" | "config" | "table";
}

export const PROFILE_WIDGETS: WidgetSpec[] = [
  {
    key: "stats",
    label: "Stats",
    blurb: "Posts, followers and views at a glance.",
    icon: "BarChart3",
    tint: "blue",
    status: "live",
    source: "derived",
  },
  {
    key: "achievements",
    label: "Achievements",
    blurb: "How many trophies you've earned.",
    icon: "Trophy",
    tint: "amber",
    status: "live",
    source: "derived",
  },
  {
    key: "trust",
    label: "Trust Index",
    blurb: "Your rank and trust score.",
    icon: "ShieldCheck",
    tint: "emerald",
    status: "live",
    source: "derived",
  },
  {
    key: "collections",
    label: "Collections",
    blurb: "How many collections you've made.",
    icon: "FolderHeart",
    tint: "rose",
    status: "live",
    source: "derived",
  },
  {
    key: "downloads",
    label: "Downloads",
    blurb: "What you've saved from other platforms.",
    icon: "Download",
    tint: "cyan",
    status: "live",
    source: "derived",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    blurb: "Your latest project.",
    icon: "LayoutGrid",
    tint: "violet",
    status: "live",
    source: "table",
  },
  {
    key: "goals",
    label: "Goals",
    blurb: "A goal and how close you are to it.",
    icon: "Target",
    tint: "purple",
    status: "live",
    source: "table",
  },
  {
    key: "countdown",
    label: "Countdown",
    blurb: "Days until something you're counting down to.",
    icon: "CalendarClock",
    tint: "amber",
    status: "live",
    source: "config",
    fields: [
      { key: "title", label: "What are you counting down to?", type: "text", max: 60 },
      { key: "date", label: "Date", type: "date" },
    ],
  },
  {
    key: "quote",
    label: "Quote",
    blurb: "A line you want on your profile.",
    icon: "Quote",
    tint: "slate",
    status: "live",
    source: "config",
    fields: [
      { key: "text", label: "Quote", type: "text", max: 200 },
      { key: "attribution", label: "Who said it", type: "text", max: 60 },
    ],
  },
  {
    key: "hours",
    label: "Business hours",
    blurb: "Whether you're open right now.",
    icon: "Clock",
    tint: "amber",
    status: "live",
    source: "table",
  },
  {
    key: "events",
    label: "Next event",
    blurb: "Your next event and who's coming.",
    icon: "CalendarDays",
    tint: "rose",
    status: "live",
    source: "table",
  },
  {
    key: "store",
    label: "Store",
    blurb: "A product or service you're selling.",
    icon: "Package",
    tint: "emerald",
    status: "live",
    source: "table",
  },
  {
    key: "spaces",
    label: "Spaces",
    blurb: "Links to your Personal Spaces.",
    icon: "Boxes",
    tint: "violet",
    status: "live",
    source: "table",
  },

  /* ─────────── Need a third party. Declared, never enableable. ─────────── */
  {
    key: "music",
    label: "Current music",
    blurb: "What you're listening to.",
    icon: "Music",
    tint: "rose",
    status: "planned",
    needs: "a music-service connection (Spotify or Apple Music OAuth)",
    source: "table",
  },
  {
    key: "weather",
    label: "Weather",
    blurb: "The weather where you are.",
    icon: "CloudSun",
    tint: "cyan",
    status: "planned",
    needs: "a weather provider, and a location you've chosen to share",
    source: "table",
  },
  {
    key: "calendar",
    label: "Calendar",
    blurb: "Your availability.",
    icon: "Calendar",
    tint: "blue",
    status: "planned",
    needs: "a calendar connection (Google or Apple)",
    source: "table",
  },
  {
    key: "live",
    label: "Live",
    blurb: "When you're streaming next.",
    icon: "Radio",
    tint: "purple",
    status: "planned",
    needs: "live streaming, which this platform doesn't run yet",
    source: "table",
  },
];

const BY_KEY = new Map(PROFILE_WIDGETS.map((w) => [w.key, w]));

export function profileWidget(key: string): WidgetSpec | undefined {
  return BY_KEY.get(key as WidgetKey);
}

export const LIVE_WIDGET_KEYS = PROFILE_WIDGETS.filter((w) => w.status === "live").map((w) => w.key) as [
  WidgetKey,
  ...WidgetKey[],
];

/** The API's guard: only a live widget can be switched on. */
export function canEnableWidget(key: string): key is WidgetKey {
  return BY_KEY.get(key as WidgetKey)?.status === "live";
}

/**
 * Strips a widget's stored config down to the fields it actually declares,
 * coerced to strings and length-capped.
 *
 * `config` is jsonb — whatever was last written. Trusting it would mean
 * rendering arbitrary stored values, so the registry is the schema and this is
 * where it is enforced, on the way OUT as well as in.
 */
export function sanitizeWidgetConfig(key: string, config: Record<string, unknown>): Record<string, string> {
  const spec = BY_KEY.get(key as WidgetKey);
  if (!spec?.fields) return {};
  const out: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = config[field.key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) out[field.key] = text.slice(0, field.max ?? 200);
  }
  return out;
}
