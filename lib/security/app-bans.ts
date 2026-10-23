import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { matchBan, type BanIndex, type BanProbe, type BanRow } from "@/lib/security/ban-match";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  IS THIS REQUEST BANNED? — the fetch route's check (0267, 2026-10-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The active bans are a small table, read ONCE a minute per server instance into memory (an index of
 * the identifiers they carry), so the check a fetch pays is a few Set lookups — never a database round
 * trip on the path every download starts with. Matching is pure (lib/security/ban-match.ts, tested).
 *
 * 🔴 FAILS OPEN. A failed read keeps the last good index (or none): a database blip must not lock every
 * visitor out of the downloader. A ban made on the admin page reaches this instance within a minute
 * (and at once on the instance that made it — `forgetBans`).
 */

const TTL_MS = 60_000;
let cache: { at: number; index: BanIndex } | null = null;
let loading: Promise<BanIndex | null> | null = null;

function buildIndex(rows: readonly BanRow[]): BanIndex {
  const index: BanIndex = { users: new Set(), devices: new Set(), fingerprints: new Set(), ipBrowsers: new Set() };
  for (const r of rows) {
    if (r.user_id) index.users.add(r.user_id);
    if (r.device_id) index.devices.add(r.device_id);
    if (r.fingerprint) index.fingerprints.add(r.fingerprint);
    if (r.ip && r.user_agent) index.ipBrowsers.add(`${r.ip}|${r.user_agent}`);
  }
  return index;
}

async function load(): Promise<BanIndex | null> {
  try {
    const { data, error } = await createAdminClient().from("app_bans").select("user_id, device_id, fingerprint, ip, user_agent").is("lifted_at", null).limit(20_000);
    if (error) return null;
    return buildIndex((data ?? []) as BanRow[]);
  } catch {
    return null;
  }
}

async function currentIndex(): Promise<BanIndex | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;
  loading ??= load().finally(() => (loading = null));
  const fresh = await loading;
  if (fresh) cache = { at: Date.now(), index: fresh };
  return cache?.index ?? null;
}

/** True when the request matches an active ban. Fails open (false) when bans cannot be read. */
export async function isBanned(probe: BanProbe): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const index = await currentIndex();
  return index ? matchBan(index, probe) : false;
}

/** After the admin bans or lifts a ban: this instance re-reads at once instead of within the minute. */
export function forgetBans(): void {
  cache = null;
}

/**
 * The visitor's network address as THIS server saw it. Cloudflare (in front of the site) names it in
 * cf-connecting-ip; the worker's own edge in x-real-ip; otherwise the LAST x-forwarded-for hop — the one
 * an edge appended, not one the browser could have written (see lib/downloads/browser-direct.ts).
 */
export function requestIp(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1)?.slice(0, 64) ?? null;
}
