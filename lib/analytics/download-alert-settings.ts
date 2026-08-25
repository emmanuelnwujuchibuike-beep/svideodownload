import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The "🎉 N downloads" milestone email, made adjustable from the dashboard.
 *
 * Owner, 2026-08-24: "put a way in admin dashboard, i can turn off, extend or
 * shorten the download threshold email alert from 100 to any number or turn it
 * off."
 *
 * ── 🔴 WHY THE DATABASE AND NOT `ALERT_DOWNLOAD_EVERY` ──────────────────────
 * The threshold was an environment variable, which means changing it is a
 * dashboard visit plus a REDEPLOY, and a variable set to the empty string is
 * silently falsy — the exact trap that left every cron 403ing for days
 * (lib/cron/auth.ts). A number the owner is expected to tune belongs somewhere
 * it can be tuned, read back and turned off in seconds. The env var is still
 * honoured as the DEFAULT so nothing changes for a deployment that set it.
 *
 * ── 🔴 CACHED, BECAUSE THIS IS ON THE DOWNLOAD PATH ─────────────────────────
 * `checkDownloadMilestone` runs after every completed download. An uncached
 * read would add a Supabase round-trip to the hottest write in the product for
 * a value that changes maybe twice a year. Same 60s TTL as `getPlanLimits`.
 */

export interface DownloadAlertSettings {
  /** Email every N downloads. */
  every: number;
  /** Master switch — false stops the milestone email entirely. */
  enabled: boolean;
}

const SETTINGS_KEY = "download_alerts";
const TTL_MS = 60_000;

/** Env var as the default, so an existing deployment's setting still applies. */
export const DEFAULT_DOWNLOAD_ALERTS: DownloadAlertSettings = {
  every: Math.max(1, Number(process.env.ALERT_DOWNLOAD_EVERY) || 100),
  enabled: true,
};

let cache: { at: number; value: DownloadAlertSettings } | null = null;

/** Clamp anything read or written into a range that cannot break the caller. */
export function normalizeDownloadAlerts(raw: unknown): DownloadAlertSettings {
  const v = (raw ?? {}) as Partial<DownloadAlertSettings>;
  const every =
    typeof v.every === "number" && Number.isFinite(v.every)
      ? Math.min(10_000_000, Math.max(1, Math.floor(v.every)))
      : DEFAULT_DOWNLOAD_ALERTS.every;
  // `enabled` defaults to TRUE when absent: a row written before this field
  // existed, or a partial write, must not silently switch the alert off.
  const enabled = typeof v.enabled === "boolean" ? v.enabled : true;
  return { every, enabled };
}

export async function getDownloadAlerts(): Promise<DownloadAlertSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    const value = data?.value ? normalizeDownloadAlerts(data.value) : DEFAULT_DOWNLOAD_ALERTS;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    // A settings outage must never stop downloads being recorded, and must not
    // start spamming either — fall back to the configured default.
    return DEFAULT_DOWNLOAD_ALERTS;
  }
}

export async function setDownloadAlerts(next: DownloadAlertSettings): Promise<void> {
  const value = normalizeDownloadAlerts(next);
  await createAdminClient()
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value }, { onConflict: "key" });
  cache = null; // bust this instance immediately; others expire within the TTL
}
