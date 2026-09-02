import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  DEFAULT_PINNED_METRICS,
  DEFAULT_WIDGET_ORDER,
  isMetricId,
  isWidgetId,
  MAX_PINNED_METRICS,
  resolveLayout,
  resolvePinnedMetrics,
  type MetricId,
  type WidgetId,
} from "./widgets";

/**
 * Creator Studio preferences (Feature 15 · Part 9) — the dashboard a creator
 * arranged for themselves.
 *
 * 🔴 This file is server-only and imports FROM `widgets.ts`, never the reverse.
 * The customiser is a client component and imports the catalogue directly; if
 * that dependency were ever flipped, `next build` would fail on a `server-only`
 * module reaching the browser — which is exactly how Part 8's Orbit rail broke,
 * with `tsc --noEmit` reporting nothing.
 *
 * A creator who has never opened the customiser has NO ROW. Defaults live in
 * code rather than being pre-seeded into the table for every member: 100% of
 * accounts would carry a row that 99% never edit.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StudioPrefs {
  layout: WidgetId[];
  hiddenWidgets: WidgetId[];
  pinnedMetrics: MetricId[];
  accent: string;
  /** 0 means no goal set — a different thing from a goal of zero. */
  weeklyGoal: number;
}

export const DEFAULT_PREFS: StudioPrefs = {
  layout: DEFAULT_WIDGET_ORDER,
  hiddenWidgets: [],
  pinnedMetrics: DEFAULT_PINNED_METRICS,
  accent: "default",
  weeklyGoal: 0,
};

interface PrefsRow {
  widget_order: string[] | null;
  hidden_widgets: string[] | null;
  pinned_metrics: string[] | null;
  accent: string | null;
  weekly_goal: number | null;
}

export async function getStudioPrefs(userId: string): Promise<StudioPrefs> {
  if (!hasSupabase) return DEFAULT_PREFS;
  try {
    const { data } = await createAdminClient()
      .from("creator_studio_prefs")
      .select("widget_order, hidden_widgets, pinned_metrics, accent, weekly_goal")
      .eq("user_id", userId)
      .maybeSingle();

    const row = data as PrefsRow | null;
    if (!row) return DEFAULT_PREFS;

    return {
      layout: resolveLayout({ widgetOrder: row.widget_order, hiddenWidgets: row.hidden_widgets }),
      hiddenWidgets: (row.hidden_widgets ?? []).filter(isWidgetId),
      pinnedMetrics: resolvePinnedMetrics(row.pinned_metrics),
      accent: row.accent ?? "default",
      weeklyGoal: Math.max(0, Math.min(100, row.weekly_goal ?? 0)),
    };
  } catch {
    // A missing table (pre-migration) must not take the whole dashboard down —
    // it degrades to the default layout, which is a working dashboard.
    return DEFAULT_PREFS;
  }
}

export interface StudioPrefsPatch {
  widgetOrder?: string[];
  hiddenWidgets?: string[];
  pinnedMetrics?: string[];
  accent?: string;
  weeklyGoal?: number;
}

/** Validated at the boundary: an unknown widget or metric id is dropped here,
 *  so nothing invalid is ever persisted and the read path's filtering is a
 *  second line of defence rather than the only one. */
export async function setStudioPrefs(userId: string, patch: StudioPrefsPatch): Promise<StudioPrefs> {
  if (!hasSupabase) return DEFAULT_PREFS;

  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.widgetOrder) row.widget_order = patch.widgetOrder.filter(isWidgetId);
  if (patch.hiddenWidgets) row.hidden_widgets = patch.hiddenWidgets.filter(isWidgetId);
  if (patch.pinnedMetrics) {
    row.pinned_metrics = [...new Set(patch.pinnedMetrics.filter(isMetricId))].slice(0, MAX_PINNED_METRICS);
  }
  if (typeof patch.accent === "string") row.accent = patch.accent.slice(0, 32);
  if (typeof patch.weeklyGoal === "number" && Number.isFinite(patch.weeklyGoal)) {
    row.weekly_goal = Math.max(0, Math.min(100, Math.round(patch.weeklyGoal)));
  }

  try {
    await createAdminClient().from("creator_studio_prefs").upsert(row, { onConflict: "user_id" });
  } catch {
    /* best-effort: a failed layout save must not lose the creator's page */
  }
  return getStudioPrefs(userId);
}
