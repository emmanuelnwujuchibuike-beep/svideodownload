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
  /** Part 8 Smart Daily Digest opt-out. */
  digestEnabled: boolean;
  /** System-managed — set by the digest cron, never by the settings API. */
  lastDigestSentAt: string | null;
  /**
   * 0233 (Feature 20): the IANA zone the quiet-hours window is read in. Null = the
   * hours are UTC, as before 0233 — nobody's window moves until they save a zone.
   */
  quietHoursTz: string | null;
  /** 0233: one summary push when a hold (DND, focus mode, quiet hours) ends. */
  heldSummaryEnabled: boolean;
  /** 0233: favourite friends reach the lock screen during quiet hours — never DND or a focus mode. */
  favoritesBypassQuiet: boolean;
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
  digestEnabled: true,
  lastDigestSentAt: null,
  quietHoursTz: null,
  heldSummaryEnabled: true,
  favoritesBypassQuiet: false,
};

interface Row {
  quiet_hours_tz?: string | null;
  held_summary_enabled?: boolean | null;
  favorites_bypass_quiet?: boolean | null;
  master_enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  category_prefs: Partial<Record<NotificationCategory, CategoryPref>> | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start_utc: number;
  quiet_hours_end_utc: number;
  hide_push_preview: boolean;
  digest_enabled: boolean;
  last_digest_sent_at: string | null;
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
    digestEnabled: r.digest_enabled,
    lastDigestSentAt: r.last_digest_sent_at,
    quietHoursTz: r.quiet_hours_tz ?? null,
    heldSummaryEnabled: r.held_summary_enabled ?? true,
    favoritesBypassQuiet: r.favorites_bypass_quiet ?? false,
  };
}

/** An hour on the clock in `tz` (today's offset) as a UTC hour. Whole-hour precision, as quiet hours are. */
export function zoneHourToUtc(hour: number, tz: string, now = new Date()): number {
  try {
    const local = Number.parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now), 10);
    let offset = local - now.getUTCHours();
    // across midnight (01:00 there, 23:00 UTC) the raw difference is a day off
    if (offset > 14) offset -= 24;
    if (offset < -12) offset += 24;
    return (((hour - offset) % 24) + 24) % 24;
  } catch {
    return hour;
  }
}

/** A real IANA zone, or null. Anything the runtime can't format in is refused rather than stored. */
export function cleanTimeZone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const tz = v.trim();
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
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

const BASE_COLS =
  "master_enabled, push_enabled, in_app_enabled, category_prefs, quiet_hours_enabled, quiet_hours_start_utc, quiet_hours_end_utc, hide_push_preview, digest_enabled, last_digest_sent_at";
// 0233's columns — the owner applies migrations by hand, so the read falls back to the older shape until they exist
const DELIVERY_COLS = "quiet_hours_tz, held_summary_enabled, favorites_bypass_quiet";
const NEW_COLUMNS = new Set(DELIVERY_COLS.split(", "));

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  try {
    const db = createAdminClient();
    let res = await db.from("notification_settings").select(`${BASE_COLS}, ${DELIVERY_COLS}`).eq("user_id", userId).maybeSingle();
    if (res.error) res = (await db.from("notification_settings").select(BASE_COLS).eq("user_id", userId).maybeSingle()) as typeof res;
    return res.data ? fromRow(res.data as Row) : DEFAULT_NOTIFICATION_SETTINGS;
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
  digestEnabled?: boolean;
  /** null clears it (back to UTC hours) */
  quietHoursTz?: string | null;
  heldSummaryEnabled?: boolean;
  favoritesBypassQuiet?: boolean;
}

/** `pending`: only 0233's columns were asked for and they don't exist yet — the caller says so in words. */
export async function setNotificationSettings(userId: string, patch: NotificationSettingsPatch): Promise<{ ok: boolean; pending?: boolean }> {
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
    if (typeof patch.digestEnabled === "boolean") clean.digest_enabled = patch.digestEnabled;
    if (patch.quietHoursTz !== undefined) clean.quiet_hours_tz = patch.quietHoursTz === null ? null : cleanTimeZone(patch.quietHoursTz);
    if (typeof patch.heldSummaryEnabled === "boolean") clean.held_summary_enabled = patch.heldSummaryEnabled;
    if (typeof patch.favoritesBypassQuiet === "boolean") clean.favorites_bypass_quiet = patch.favoritesBypassQuiet;
    if (Object.keys(clean).length === 0) return { ok: true };
    const write = (cols: Record<string, unknown>) =>
      db.from("notification_settings").upsert({ user_id: userId, ...cols, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    const { error } = await write(clean);
    if (!error) return { ok: true };
    // before 0233: save everything else, and say plainly that the new switches aren't ready
    if (/column|schema cache/i.test(error.message)) {
      const older = Object.fromEntries(Object.entries(clean).filter(([k]) => !NEW_COLUMNS.has(k)));
      // hours sent in a zone can't be stored with it yet — store them as UTC, the pre-0233 meaning
      const tz = typeof clean.quiet_hours_tz === "string" ? clean.quiet_hours_tz : null;
      if (tz) {
        if (typeof older.quiet_hours_start_utc === "number") older.quiet_hours_start_utc = zoneHourToUtc(older.quiet_hours_start_utc, tz);
        if (typeof older.quiet_hours_end_utc === "number") older.quiet_hours_end_utc = zoneHourToUtc(older.quiet_hours_end_utc, tz);
      }
      if (Object.keys(older).length === 0) return { ok: false, pending: true };
      const retry = await write(older);
      return retry.error ? { ok: false } : { ok: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** System-managed — called only by the digest cron after a successful send.
 * Upserts (not a plain update) so it works even for a user with no prior
 * settings row (the common case — most users never touch /account's
 * notification settings, so their row is created here on first digest). */
export async function markDigestSent(userId: string): Promise<void> {
  try {
    const db = createAdminClient();
    await db
      .from("notification_settings")
      .upsert({ user_id: userId, last_digest_sent_at: new Date().toISOString() }, { onConflict: "user_id" })
      .then(undefined, () => {});
  } catch {
    /* best-effort — worst case the next cron run re-sends one extra digest */
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
