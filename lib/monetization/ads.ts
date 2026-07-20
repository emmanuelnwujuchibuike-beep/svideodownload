import { createAdminClient } from "@/lib/supabase/admin";

import { isServableFormat } from "./ad-schema";
import type { AdSlotData } from "./types";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface CacheEntry {
  ads: AdSlotData[];
  at: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

interface AdRow {
  id: string;
  zone: string;
  network: string;
  format: string;
  script_code: string | null;
  image_url: string | null;
  target_url: string | null;
  headline: string | null;
  width: number | null;
  height: number | null;
  ad_client?: string | null;
  ad_slot_id?: string | null;
  ad_layout?: string | null;
  skippable?: boolean | null;
  skip_after_seconds?: number | null;
  weight: number;
}

function toSlot(r: AdRow): AdSlotData {
  return {
    id: r.id,
    zone: r.zone,
    network: r.network,
    /*
      Not `?? "display"`. An unrecognised format used to fall through to the
      display branch, which injects whatever is in `script_code` — so a typo'd
      or retired format would still run a script. `loadZone` drops those rows
      before they reach here; this cast is only reached for formats that already
      passed `isServableFormat`.
    */
    format: r.format as AdSlotData["format"],
    scriptCode: r.script_code,
    imageUrl: r.image_url,
    targetUrl: r.target_url,
    headline: r.headline,
    width: r.width,
    height: r.height,
    adClient: r.ad_client ?? null,
    adSlotId: r.ad_slot_id ?? null,
    adLayout: r.ad_layout ?? null,
    /*
      Defaults matter here: these columns arrive with migration 0090, and until
      it is applied every row reads back `undefined`. Defaulting to "skippable
      after 5s" keeps a waiting visitor able to get past an ad on a database
      that has not caught up, which is the safe direction to fail.
    */
    skippable: r.skippable ?? true,
    skipAfterSeconds: r.skip_after_seconds ?? 5,
  };
}

/**
 * Columns to select.
 *
 * Built as a list rather than a literal because 0090's columns may not exist
 * yet — see `selectColumns` below for why that matters and how it is handled.
 */
const BASE_COLUMNS =
  "id, zone, network, format, script_code, image_url, target_url, headline, width, height, weight";
const V2_COLUMNS = "ad_client, ad_slot_id, ad_layout, skippable, skip_after_seconds";

/** Active ads for a zone (priority ASC), cached 60s. */
async function loadZone(zone: string): Promise<AdSlotData[]> {
  const hit = cache.get(zone);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ads;
  if (!hasSupabase) return [];
  try {
    const supabase = createAdminClient();

    const query = (columns: string) =>
      supabase
        .from("ads")
        .select(columns)
        .eq("zone", zone)
        .eq("active", true)
        .order("priority", { ascending: true });

    /*
      Migration 0090 adds the AdSense and skip columns. Selecting them before it
      is applied fails the whole query with 42703 (undefined column) — which
      would take every ad on the site down, not just the new fields. So: ask for
      them, and fall back to the columns that have always existed.

      The same 42703 shape 0083 established. `toSlot` defaults the missing
      fields, so a pre-0090 database serves display and native units normally
      and simply cannot serve AdSense ones.
    */
    let { data, error } = await query(`${BASE_COLUMNS}, ${V2_COLUMNS}`);
    if (error?.code === "42703") ({ data, error } = await query(BASE_COLUMNS));
    if (error) return [];

    const ads = ((data ?? []) as unknown as AdRow[])
      /*
        The serving gate. A retired `pop` row stays in the table — deactivating
        it is 0090's job and these migrations are applied by hand — so the
        format filter is what actually stops it being served, today, without
        waiting for anything.
      */
      .filter((r) => isServableFormat(r.format))
      .map((r) => ({ ...toSlot(r), weight: r.weight }));

    cache.set(zone, { ads, at: Date.now() });
    return ads;
  } catch {
    return [];
  }
}

/** Weighted pick of an active ad for a zone (the highest-priority tier wins). */
export async function getAdForZone(zone: string): Promise<AdSlotData | null> {
  const ads = await loadZone(zone);
  if (ads.length === 0) return null;
  if (ads.length === 1) return ads[0]!;
  // Weighted random within the loaded set (priority already ordered the query).
  const rows = ads as (AdSlotData & { weight?: number })[];
  const total = rows.reduce((s, a) => s + Math.max(1, a.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const a of rows) {
    r -= Math.max(1, a.weight ?? 1);
    if (r <= 0) return a;
  }
  return rows[0]!;
}

/** All active ads in a zone (used for page-level `global` scripts). */
export async function getAdsForZone(zone: string): Promise<AdSlotData[]> {
  return loadZone(zone);
}

export function clearAdCache(): void {
  cache.clear();
}

/** Full admin row (all fields, incl. disabled) for the ad manager. */
export interface AdRecord {
  id: string;
  zone: string;
  network: string;
  format: string;
  script_code: string | null;
  image_url: string | null;
  target_url: string | null;
  headline: string | null;
  width: number | null;
  height: number | null;
  ad_client: string | null;
  ad_slot_id: string | null;
  ad_layout: string | null;
  skippable: boolean;
  skip_after_seconds: number;
  priority: number;
  weight: number;
  active: boolean;
  created_at: string;
}

/**
 * Admin: every ad row across all zones.
 *
 * Deliberately UNFILTERED by format — the admin must still show a retired `pop`
 * row so an operator can see why it stopped serving and delete it. Hiding it
 * would make an inert row invisible and unexplained.
 */
export async function listAds(): Promise<AdRecord[]> {
  if (!hasSupabase) return [];
  const ADMIN_BASE =
    "id, zone, network, format, script_code, image_url, target_url, headline, width, height, priority, weight, active, created_at";
  try {
    const supabase = createAdminClient();
    const query = (columns: string) =>
      supabase
        .from("ads")
        .select(columns)
        .order("zone", { ascending: true })
        .order("priority", { ascending: true });

    // Same pre-0090 fallback as loadZone — the admin must not 500 on a database
    // that has not had the migration applied yet.
    let { data, error } = await query(`${ADMIN_BASE}, ${V2_COLUMNS}`);
    if (error?.code === "42703") ({ data, error } = await query(ADMIN_BASE));
    if (error) return [];

    return ((data ?? []) as unknown as Partial<AdRecord>[]).map((r) => ({
      ...(r as AdRecord),
      ad_client: r.ad_client ?? null,
      ad_slot_id: r.ad_slot_id ?? null,
      ad_layout: r.ad_layout ?? null,
      skippable: r.skippable ?? true,
      skip_after_seconds: r.skip_after_seconds ?? 5,
    }));
  } catch {
    return [];
  }
}
