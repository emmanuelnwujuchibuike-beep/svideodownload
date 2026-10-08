"use client";

import { getClient } from "@/lib/supabase/client-lazy";

/**
 * The member's own unfinished applications, read straight from Postgres with
 * their own session — Row Level Security (0195) returns only their rows. No
 * Vercel function. One read, when the application page opens signed in.
 */

export interface MyCreative {
  id: string;
  status: string;
  media_type: "image" | "video";
  media_url: string | null;
  thumbnail_url: string | null;
  destination_url: string | null;
  headline: string | null;
  description: string | null;
  validation_status: string;
  url_validation_status: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | string | null;
  file_size_bytes: number | null;
}

export interface MyCampaign {
  id: string;
  application_id: string | null;
  name: string;
  status: string;
  duration_id: string;
  updated_at: string;
  ad_placements: { code: string; format_code: string } | null;
  ad_creatives: MyCreative[];
}

export interface MyApplication {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  formatCode: string | null;
  placementCodes: string[];
  durationId: string;
  creative: MyCreative | null;
}

export async function loadMyApplications(): Promise<{ applications: MyApplication[]; businessName: string | null }> {
  try {
    const sb = await getClient();
    const [campaigns, advertiser] = await Promise.all([
      sb
        .from("ad_campaigns")
        .select(
          "id, application_id, name, status, duration_id, updated_at, ad_placements(code, format_code), ad_creatives(id, status, media_type, media_url, thumbnail_url, destination_url, headline, description, validation_status, url_validation_status, width, height, duration_seconds, file_size_bytes)",
        )
        .in("status", ["draft", "awaiting_payment"])
        .order("updated_at", { ascending: false })
        .limit(50),
      sb.from("advertisers").select("business_name").maybeSingle(),
    ]);
    const rows = (campaigns.data ?? []) as unknown as MyCampaign[];
    const byApp = new Map<string, MyCampaign[]>();
    for (const r of rows) {
      const key = r.application_id ?? r.id;
      byApp.set(key, [...(byApp.get(key) ?? []), r]);
    }
    const applications: MyApplication[] = [];
    for (const [id, group] of byApp) {
      const head = group.find((g) => g.id === id) ?? group[0]!;
      applications.push({
        id: head.id,
        name: head.name,
        status: head.status,
        updatedAt: head.updated_at,
        formatCode: head.ad_placements?.format_code ?? null,
        placementCodes: [head, ...group.filter((g) => g !== head)].map((g) => g.ad_placements?.code).filter((c): c is string => !!c),
        durationId: head.duration_id,
        creative: head.ad_creatives.find((c) => c.status === "active" && c.validation_status === "valid") ?? null,
      });
    }
    return { applications, businessName: (advertiser.data as { business_name?: string } | null)?.business_name ?? null };
  } catch {
    return { applications: [], businessName: null };
  }
}
