import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Curated "Recommended Tools" + affiliate records, all backed by the
 * `affiliate_offers` table. Public reads (`getRecommendedTools`) only ever
 * return active, in-schedule rows for the requested placement; admin reads
 * (`listAffiliates`) return everything for the management table.
 */

export const PLACEMENTS = [
  "homepage",
  "download_result",
  "blog",
  "footer",
  "sidebar",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Public, render-ready tool card. `url` is the TRACKED redirect. */
export interface RecommendedTool {
  id: string;
  name: string;
  description: string | null;
  url: string; // /api/go/<id>
  imageUrl: string | null;
  cta: string;
  category: string | null;
}

/** Full admin record (all fields, incl. disabled/scheduled). */
export interface AffiliateRecord {
  id: string;
  name: string;
  description: string | null;
  url: string;
  image_url: string | null;
  cta: string;
  category: string | null;
  placements: string[];
  priority: number;
  sort_order: number;
  weight: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const SELECT =
  "id, name, description, url, image_url, cta, category, placements, priority, sort_order, weight, active, starts_at, ends_at, created_at";

interface CacheEntry {
  rows: AffiliateRecord[];
  at: number;
}
let activeCache: CacheEntry | null = null;
const TTL_MS = 60_000;

/** Active + in-schedule rows (cached). Used by all public render paths. */
async function liveRows(): Promise<AffiliateRecord[]> {
  if (activeCache && Date.now() - activeCache.at < TTL_MS) return activeCache.rows;
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const nowIso = new Date().toISOString();
    const { data } = await db
      .from("affiliate_offers")
      .select(SELECT)
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order("sort_order", { ascending: true })
      .order("priority", { ascending: true });
    activeCache = { rows: (data as AffiliateRecord[]) ?? [], at: Date.now() };
    return activeCache.rows;
  } catch {
    return [];
  }
}

/**
 * Recommended tools for a placement — active, in-schedule, ordered. Returns the
 * tracked redirect URL so every click is recorded. `limit` caps the list.
 */
export async function getRecommendedTools(
  placement: Placement,
  limit = 8,
): Promise<RecommendedTool[]> {
  const rows = (await liveRows()).filter((r) => r.placements?.includes(placement));
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    url: `/api/go/${r.id}`,
    imageUrl: r.image_url,
    cta: r.cta || "Visit",
    category: r.category,
  }));
}

/** Admin: every affiliate row (incl. disabled / scheduled), newest sort first. */
export async function listAffiliates(): Promise<AffiliateRecord[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("affiliate_offers")
      .select(SELECT)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    return (data as AffiliateRecord[]) ?? [];
  } catch {
    return [];
  }
}

export function clearAffiliateCache(): void {
  activeCache = null;
}
