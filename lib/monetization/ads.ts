import { createAdminClient } from "@/lib/supabase/admin";

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
  weight: number;
}

function toSlot(r: AdRow): AdSlotData {
  return {
    id: r.id,
    zone: r.zone,
    network: r.network,
    format: (r.format as AdSlotData["format"]) ?? "display",
    scriptCode: r.script_code,
    imageUrl: r.image_url,
    targetUrl: r.target_url,
    headline: r.headline,
    width: r.width,
    height: r.height,
  };
}

/** Active ads for a zone (priority ASC), cached 60s. */
async function loadZone(zone: string): Promise<AdSlotData[]> {
  const hit = cache.get(zone);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ads;
  if (!hasSupabase) return [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("ads")
      .select(
        "id, zone, network, format, script_code, image_url, target_url, headline, width, height, weight",
      )
      .eq("zone", zone)
      .eq("active", true)
      .order("priority", { ascending: true });
    const ads = (data ?? []).map((r) => ({ ...toSlot(r as AdRow), weight: (r as AdRow).weight }));
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
