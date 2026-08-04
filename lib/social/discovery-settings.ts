import { cache } from "react";

import { DEFAULT_DISCOVERY, normalizeFields, type DiscoverySettings } from "@/lib/discovery/fields";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One member's discovery settings (migration 0113).
 *
 * Fail-closed to `DEFAULT_DISCOVERY`, which deliberately EXCLUDES city and
 * country. A failed read therefore makes someone slightly harder to find,
 * never accidentally enumerable by location — the direction a privacy default
 * has to fail in, because one of those outcomes is an inconvenience and the
 * other cannot be taken back.
 *
 * Deduped per request: the settings screen and any search on the same render
 * share one read.
 */
export const getDiscoverySettings = cache(async (userId: string): Promise<DiscoverySettings> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return DEFAULT_DISCOVERY;
  try {
    const { data, error } = await createAdminClient()
      .from("profile_discovery")
      .select("discoverable, search_fields, directory_listed")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return DEFAULT_DISCOVERY;
    const row = data as Record<string, unknown>;
    return {
      discoverable: row.discoverable !== false,
      fields: normalizeFields(row.search_fields),
      directoryListed: row.directory_listed === true,
    };
  } catch {
    return DEFAULT_DISCOVERY;
  }
});
