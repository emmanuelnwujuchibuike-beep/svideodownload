import { normalizePlatformStatus, type PlatformStatusMap } from "@/lib/platform-status";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads and writes the operator-declared platform status, in the `settings` table
 * under key `platform_status` — the same shape `lib/landing/settings.ts` uses, so
 * there is one pattern for "an admin field the public site reads".
 *
 * ── 🔴 Read through the SERVICE-ROLE client, never a request-scoped one ────
 *
 * The badge renders on `/`, which is statically generated. A cookie-reading
 * client here would opt the whole route out of static generation and cost the
 * landing page its edge cache — the exact trap recorded on `getLandingSettings`.
 * No cookies, no headers, so `/` stays static and the value refreshes at the ISR
 * cadence.
 *
 * ── The cache TTL is short on purpose ─────────────────────────────────────
 *
 * This is an OUTAGE flag. When an operator marks TikTok down they are reacting to
 * something happening now, and a ten-minute cache would keep telling visitors it
 * works. Thirty seconds keeps the read cheap while making the change feel
 * immediate on the operator's own request; visitors see it at the ISR cadence.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: PlatformStatusMap } | null = null;
const TTL_MS = 30_000;

export async function getPlatformStatus(): Promise<PlatformStatusMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return {};
  try {
    const db = createAdminClient();
    const { data } = await db.from("settings").select("value").eq("key", "platform_status").maybeSingle();
    const value = normalizePlatformStatus(data?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch {
    /*
      Fail OPEN. A failed read must not paint every platform red — see the long
      note in lib/platform-status.ts. An empty map means "nothing to report",
      which is both the correct default and the common case.
    */
    return {};
  }
}

export async function setPlatformStatus(map: PlatformStatusMap): Promise<void> {
  const db = createAdminClient();
  // Re-normalised on write as well as on read: the API validates, but this is
  // the last gate before a value the public site renders.
  const value = normalizePlatformStatus(map);
  await db.from("settings").upsert({ key: "platform_status", value }, { onConflict: "key" });
  cache = null;
}
