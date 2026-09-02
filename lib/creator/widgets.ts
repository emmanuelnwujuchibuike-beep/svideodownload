/**
 * The Creator Home widget catalogue and the layout maths (Feature 15 · Part 9).
 *
 * 🔴 CLIENT-SAFE ON PURPOSE. This file must never import a data layer.
 *
 * Part 8 shipped `lib/social/orbits.ts` holding both a catalogue and a
 * server-only fetcher; a client component importing only the TYPES from it
 * still pulled `server-only` into the browser bundle, and `next build` failed
 * where `tsc --noEmit` had been perfectly happy. The fix there was to split the
 * file. This Part starts split: the catalogue and ordering rules live here, and
 * `lib/creator/prefs.ts` — which touches Supabase — imports FROM this file,
 * never the other way round.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type WidgetId =
  | "performance"
  | "goal"
  | "latest"
  | "followers"
  | "engagement"
  | "milestone"
  | "lounge"
  | "suggestions"
  | "assistant"
  | "health";

export interface WidgetDef {
  id: WidgetId;
  label: string;
  blurb: string;
  /** Widgets a creator may not remove — the dashboard has to say something. */
  required?: boolean;
}

/** Order here is the DEFAULT layout: the numbers first, then the work, then
 *  the people, then the tools. A creator's saved order overrides it. */
export const STUDIO_WIDGETS: WidgetDef[] = [
  { id: "performance", label: "Daily performance", blurb: "Views, watch-through, engagement and new followers today.", required: true },
  { id: "goal", label: "Weekly goal", blurb: "Progress against the upload target you set." },
  { id: "latest", label: "Latest work", blurb: "Your most recent posts and how they are doing." },
  { id: "milestone", label: "Next milestone", blurb: "The nearest rung on your Creator Journey." },
  { id: "engagement", label: "Engagement overview", blurb: "Likes, comments, shares and saves at a glance." },
  { id: "followers", label: "Recent followers", blurb: "Who started following you lately." },
  { id: "lounge", label: "Community updates", blurb: "Questions on your posts that nobody has answered." },
  { id: "health", label: "Creator Health", blurb: "Consistency, satisfaction, growth and pace." },
  { id: "suggestions", label: "Content suggestions", blurb: "What your own numbers suggest doing next." },
  { id: "assistant", label: "Creator Assistant", blurb: "Ask about your own performance." },
];

const BY_ID = new Map(STUDIO_WIDGETS.map((w) => [w.id, w]));

export const DEFAULT_WIDGET_ORDER: WidgetId[] = STUDIO_WIDGETS.map((w) => w.id);

export function isWidgetId(v: string): v is WidgetId {
  return BY_ID.has(v as WidgetId);
}

export function widgetDef(id: WidgetId): WidgetDef | undefined {
  return BY_ID.get(id);
}

/**
 * The layout actually rendered, from a creator's saved preferences.
 *
 * Three properties this has to hold, all of them learned from things that have
 * gone wrong on this project before:
 *
 *  1. **Unknown ids are dropped.** A widget removed from the catalogue must not
 *     strand a saved layout or render a blank slot.
 *  2. **New widgets appear.** A widget ADDED to the catalogue after someone
 *     saved a layout is appended rather than hidden — otherwise shipping a new
 *     dashboard card would silently reach nobody who had ever customised.
 *  3. **Required widgets survive a corrupt hidden list.** The dashboard always
 *     shows something.
 */
export function resolveLayout(saved: {
  widgetOrder?: string[] | null;
  hiddenWidgets?: string[] | null;
}): WidgetId[] {
  const hidden = new Set((saved.hiddenWidgets ?? []).filter(isWidgetId));

  // De-duped as it is read: a stored array that repeats an id (a double-tapped
  // save, a merge of two clients) must not render the same card twice.
  const seen = new Set<WidgetId>();
  const ordered = (saved.widgetOrder ?? []).filter((id): id is WidgetId => {
    if (!isWidgetId(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Catalogue order for anything the saved layout never mentioned.
  const appended = DEFAULT_WIDGET_ORDER.filter((id) => !seen.has(id));

  return [...ordered, ...appended].filter((id) => !hidden.has(id) || widgetDef(id)?.required === true);
}

/** Move a widget one slot in a layout. Returns a new array; out-of-range moves
 *  are a no-op rather than an error, because the only caller is a button that
 *  can be double-tapped at either end of the list. */
export function moveWidget(order: WidgetId[], id: WidgetId, direction: -1 | 1): WidgetId[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const to = from + direction;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/* ────────────────────────────── pinned metrics ────────────────────────────── */

export type MetricId =
  | "views"
  | "followers"
  | "engagementRate"
  | "retention"
  | "posts"
  | "comments"
  | "shares"
  | "saves";

export interface MetricDef {
  id: MetricId;
  label: string;
}

export const STUDIO_METRICS: MetricDef[] = [
  { id: "views", label: "Views" },
  { id: "followers", label: "Followers" },
  { id: "engagementRate", label: "Engagement rate" },
  { id: "retention", label: "Retention" },
  { id: "posts", label: "Posts" },
  { id: "comments", label: "Comments" },
  { id: "shares", label: "Shares" },
  { id: "saves", label: "Saves" },
];

const METRIC_IDS = new Set(STUDIO_METRICS.map((m) => m.id));

export function isMetricId(v: string): v is MetricId {
  return METRIC_IDS.has(v as MetricId);
}

/** The header strip holds four. More would stop being a summary. */
export const MAX_PINNED_METRICS = 4;

export const DEFAULT_PINNED_METRICS: MetricId[] = ["views", "followers", "engagementRate", "retention"];

export function resolvePinnedMetrics(saved: string[] | null | undefined): MetricId[] {
  const valid = (saved ?? []).filter(isMetricId);
  const unique = [...new Set(valid)].slice(0, MAX_PINNED_METRICS);
  return unique.length > 0 ? unique : DEFAULT_PINNED_METRICS;
}
