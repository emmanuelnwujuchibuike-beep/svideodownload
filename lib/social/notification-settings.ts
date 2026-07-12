import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationCategory, NotificationType } from "@/lib/social/notifications";

/**
 * Part 6 — Notification Settings. Two independent gates share this module:
 * `computeShouldPush` (does sendSmartPush actually push this device?) and
 * `computeShouldShowInApp` (does the bell/Notification Center show this
 * category at all?) — both pure functions over a plain settings object, so
 * they're trivially unit-testable without a DB (see
 * lib/social/notification-settings.test.ts).
 *
 * Deliberately NOT built: per-category custom sound packs/volume (the
 * existing notification_sound_prefs table already covers foreground
 * interaction sounds — a web app can't set the OS push sound at all, on
 * either iOS or Android), unlimited named quiet-hours schedules
 * (Sleep/Work/Gym/Driving/...) — one real window is the honestly-buildable
 * core of "quiet hours", location/calendar-based activation (no infra),
 * and a bespoke admin "add a category" UI (the JSONB shape already means a
 * new category needs zero migration — see the column comment in
 * 0046_notification_settings.sql).
 */

export interface CategoryPref {
  /** Show this category in the bell dropdown / Notification Center at all. */
  enabled: boolean;
  /** Send push for this category (independent of `enabled` — you can see it
   * in-app but not have it buzz your phone). */
  push: boolean;
  /** Bypass quiet hours for this category specifically. `security` always
   * bypasses regardless of this flag — see computeShouldPush. */
  alwaysDeliver?: boolean;
}

export const DEFAULT_CATEGORY_PREF: CategoryPref = { enabled: true, push: true };

export interface NotificationSettings {
  masterEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  categoryPrefs: Partial<Record<NotificationCategory, CategoryPref>>;
  quietHoursEnabled: boolean;
  quietHoursStartUtc: number;
  quietHoursEndUtc: number;
  hidePushPreview: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  masterEnabled: true,
  pushEnabled: true,
  inAppEnabled: true,
  categoryPrefs: {},
  quietHoursEnabled: false,
  quietHoursStartUtc: 22,
  quietHoursEndUtc: 8,
  hidePushPreview: false,
};

interface Row {
  master_enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  category_prefs: Partial<Record<NotificationCategory, CategoryPref>> | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start_utc: number;
  quiet_hours_end_utc: number;
  hide_push_preview: boolean;
}

function fromRow(r: Row): NotificationSettings {
  return {
    masterEnabled: r.master_enabled,
    pushEnabled: r.push_enabled,
    inAppEnabled: r.in_app_enabled,
    categoryPrefs: r.category_prefs ?? {},
    quietHoursEnabled: r.quiet_hours_enabled,
    quietHoursStartUtc: r.quiet_hours_start_utc,
    quietHoursEndUtc: r.quiet_hours_end_utc,
    hidePushPreview: r.hide_push_preview,
  };
}

export function getCategoryPref(settings: NotificationSettings, category: NotificationCategory): CategoryPref {
  return settings.categoryPrefs[category] ?? DEFAULT_CATEGORY_PREF;
}

/** Is `hour` (0-23, UTC) inside the [start, end) quiet-hours window? Handles
 * windows that wrap past midnight (e.g. 22 → 8). A zero-width window
 * (start === end) is treated as "never active" rather than "always". */
export function isWithinQuietHours(hour: number, startUtc: number, endUtc: number): boolean {
  if (startUtc === endUtc) return false;
  if (startUtc < endUtc) return hour >= startUtc && hour < endUtc;
  return hour >= startUtc || hour < endUtc;
}

/** Should sendSmartPush actually deliver a push for this category right now? */
export function computeShouldPush(settings: NotificationSettings, category: NotificationCategory, nowUtcHour: number): boolean {
  if (!settings.masterEnabled || !settings.pushEnabled) return false;
  const pref = getCategoryPref(settings, category);
  if (!pref.enabled || !pref.push) return false;
  // Security alerts are never held back by quiet hours — not user-configurable.
  if (category === "security") return true;
  if (pref.alwaysDeliver) return true;
  if (settings.quietHoursEnabled && isWithinQuietHours(nowUtcHour, settings.quietHoursStartUtc, settings.quietHoursEndUtc)) return false;
  return true;
}

/** Should this category appear in the bell / Notification Center at all? */
export function computeShouldShowInApp(settings: NotificationSettings, category: NotificationCategory): boolean {
  if (!settings.masterEnabled || !settings.inAppEnabled) return false;
  return getCategoryPref(settings, category).enabled;
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("notification_settings")
      .select("master_enabled, push_enabled, in_app_enabled, category_prefs, quiet_hours_enabled, quiet_hours_start_utc, quiet_hours_end_utc, hide_push_preview")
      .eq("user_id", userId)
      .maybeSingle();
    return data ? fromRow(data as Row) : DEFAULT_NOTIFICATION_SETTINGS;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export interface NotificationSettingsPatch {
  masterEnabled?: boolean;
  pushEnabled?: boolean;
  inAppEnabled?: boolean;
  categoryPrefs?: Partial<Record<NotificationCategory, CategoryPref>>;
  quietHoursEnabled?: boolean;
  quietHoursStartUtc?: number;
  quietHoursEndUtc?: number;
  hidePushPreview?: boolean;
}

export async function setNotificationSettings(userId: string, patch: NotificationSettingsPatch): Promise<{ ok: boolean }> {
  try {
    const db = createAdminClient();
    const clean: Record<string, unknown> = {};
    if (typeof patch.masterEnabled === "boolean") clean.master_enabled = patch.masterEnabled;
    if (typeof patch.pushEnabled === "boolean") clean.push_enabled = patch.pushEnabled;
    if (typeof patch.inAppEnabled === "boolean") clean.in_app_enabled = patch.inAppEnabled;
    if (patch.categoryPrefs) {
      // Merge into the EXISTING jsonb (a patch for one category shouldn't
      // wipe every other category's saved prefs) rather than overwrite.
      const current = await getNotificationSettings(userId);
      clean.category_prefs = { ...current.categoryPrefs, ...patch.categoryPrefs };
    }
    if (typeof patch.quietHoursEnabled === "boolean") clean.quiet_hours_enabled = patch.quietHoursEnabled;
    if (typeof patch.quietHoursStartUtc === "number") clean.quiet_hours_start_utc = Math.max(0, Math.min(23, Math.round(patch.quietHoursStartUtc)));
    if (typeof patch.quietHoursEndUtc === "number") clean.quiet_hours_end_utc = Math.max(0, Math.min(23, Math.round(patch.quietHoursEndUtc)));
    if (typeof patch.hidePushPreview === "boolean") clean.hide_push_preview = patch.hidePushPreview;
    if (Object.keys(clean).length === 0) return { ok: true };
    const { error } = await db
      .from("notification_settings")
      .upsert({ user_id: userId, ...clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/** All NotificationType values whose category is muted for in-app display — the
 * shape lib/social/notifications.ts's list queries need for a `.not("type","in",...)` exclusion. */
export function mutedTypesFor(settings: NotificationSettings, categoryByType: Partial<Record<NotificationType, NotificationCategory>>): NotificationType[] {
  const muted: NotificationType[] = [];
  for (const [type, category] of Object.entries(categoryByType) as [NotificationType, NotificationCategory][]) {
    if (!computeShouldShowInApp(settings, category)) muted.push(type);
  }
  return muted;
}
