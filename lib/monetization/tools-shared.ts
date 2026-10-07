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

