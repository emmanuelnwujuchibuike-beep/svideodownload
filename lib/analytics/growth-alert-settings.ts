import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GROWTH MILESTONE EMAILS — visitors and members, every N (owner, 2026-09-20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "I want to receive an email on every 1,000 or 10,000 visitors and users
 * milestone, just like the download milestone email, and configure the
 * milestone amount from the admin dashboard." The same shape as
 * lib/analytics/download-alert-settings.ts — a `settings` row the dashboard
 * writes, a one-minute cache, a normaliser that never lets a partial row
 * switch an alert off — with two counters instead of one:
 *
 *   visitors  distinct visitor ids across ALL of analytics_events, bots
 *             excluded (the same "unique visitors" the dashboard shows,
 *             over all time rather than a period);
 *   users     rows in `profiles` — every account that exists.
 *
 * The check itself lives in server/services/analytics.ts beside the download
 * one; the lock is `admin_alerts.key = visitors-<milestone>` / `users-<milestone>`.
 */
export interface GrowthAlertCounter {
  every: number;
  enabled: boolean;
}

export interface GrowthAlertSettings {
  visitors: GrowthAlertCounter;
  users: GrowthAlertCounter;
}

const SETTINGS_KEY = "growth_alerts";
const TTL_MS = 60_000;

export const DEFAULT_GROWTH_ALERTS: GrowthAlertSettings = {
  visitors: { every: 1000, enabled: true },
  users: { every: 1000, enabled: true },
};

let cache: { at: number; value: GrowthAlertSettings } | null = null;

function counter(raw: unknown, fallback: GrowthAlertCounter): GrowthAlertCounter {
  const v = (raw ?? {}) as Partial<GrowthAlertCounter>;
  const every = typeof v.every === "number" && Number.isFinite(v.every) ? Math.min(100_000_000, Math.max(1, Math.floor(v.every))) : fallback.every;
  // `enabled` defaults to TRUE when absent — a partial write must not silently switch an alert off.
  const enabled = typeof v.enabled === "boolean" ? v.enabled : true;
  return { every, enabled };
}

export function normalizeGrowthAlerts(raw: unknown): GrowthAlertSettings {
  const v = (raw ?? {}) as Partial<GrowthAlertSettings>;
  return { visitors: counter(v.visitors, DEFAULT_GROWTH_ALERTS.visitors), users: counter(v.users, DEFAULT_GROWTH_ALERTS.users) };
}

export async function getGrowthAlerts(): Promise<GrowthAlertSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { data } = await createAdminClient().from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const value = data?.value ? normalizeGrowthAlerts(data.value) : DEFAULT_GROWTH_ALERTS;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return DEFAULT_GROWTH_ALERTS;
  }
}

export async function setGrowthAlerts(next: GrowthAlertSettings): Promise<void> {
  const value = normalizeGrowthAlerts(next);
  await createAdminClient().from("settings").upsert({ key: SETTINGS_KEY, value }, { onConflict: "key" });
  cache = null;
}

/** The milestone a count has crossed at this interval, or 0 when it has not crossed the first one. */
export function milestoneFor(count: number, every: number): number {
  if (!Number.isFinite(count) || count <= 0 || every <= 0) return 0;
  const m = Math.floor(count / every) * every;
  return m >= every ? m : 0;
}
