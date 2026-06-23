import { createAdminClient } from "@/lib/supabase/admin";

import type { AffiliateOffer, RequestContext } from "./types";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface OfferRow {
  id: string;
  name: string;
  description: string | null;
  url: string;
  image_url: string | null;
  cta: string;
  category: string | null;
  country_targeting: string[];
  device_targeting: string[];
  priority: number;
  weight: number;
}

let cache: { rows: OfferRow[]; at: number } | null = null;
const TTL_MS = 60_000;

async function loadOffers(): Promise<OfferRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!hasSupabase) return [];
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("affiliate_offers")
      .select(
        "id, name, description, url, image_url, cta, category, country_targeting, device_targeting, priority, weight",
      )
      .eq("active", true)
      .order("priority", { ascending: true });
    cache = { rows: (data as OfferRow[]) ?? [], at: Date.now() };
    return cache.rows;
  } catch {
    return [];
  }
}

function matches(row: OfferRow, ctx: RequestContext): boolean {
  if (row.device_targeting.length > 0 && !row.device_targeting.includes(ctx.device)) return false;
  if (
    row.country_targeting.length > 0 &&
    (!ctx.country || !row.country_targeting.map((c) => c.toUpperCase()).includes(ctx.country.toUpperCase()))
  ) {
    return false;
  }
  return true;
}

/**
 * Best affiliate offer for this visit: filter by device/country, keep the
 * highest-priority tier, then weighted-random within it. Null if none match.
 */
export async function selectAffiliateOffer(ctx: RequestContext): Promise<AffiliateOffer | null> {
  const eligible = (await loadOffers()).filter((r) => matches(r, ctx));
  if (eligible.length === 0) return null;

  const topPriority = eligible[0]!.priority;
  const tier = eligible.filter((r) => r.priority === topPriority);
  const total = tier.reduce((s, r) => s + Math.max(1, r.weight), 0);
  let pick = Math.random() * total;
  let chosen = tier[0]!;
  for (const r of tier) {
    pick -= Math.max(1, r.weight);
    if (pick <= 0) {
      chosen = r;
      break;
    }
  }
  return {
    id: chosen.id,
    name: chosen.name,
    description: chosen.description,
    url: chosen.url,
    imageUrl: chosen.image_url,
    cta: chosen.cta,
    category: chosen.category,
  };
}

/** Look up a single offer (used by the tracked-redirect route). */
export async function getOfferUrl(id: string): Promise<string | null> {
  const rows = await loadOffers();
  const row = rows.find((r) => r.id === id);
  if (row) return row.url;
  if (!hasSupabase) return null;
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("affiliate_offers")
      .select("url")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();
    return (data?.url as string) ?? null;
  } catch {
    return null;
  }
}
