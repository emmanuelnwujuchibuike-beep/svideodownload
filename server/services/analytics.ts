import { detectPlatform } from "@/lib/platforms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaKind } from "@/types";

/**
 * Best-effort, fire-and-forget download analytics. Inserts an anonymous row into
 * `downloads` (via the service-role client, bypassing RLS) which the
 * `bump_platform_stats` trigger rolls up into `platform_stats` for the admin
 * dashboard. Never blocks or fails a download.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export function recordDownloadEvent(
  url: string,
  kind: MediaKind,
  title?: string,
): void {
  if (!hasSupabase) return;
  const platform = detectPlatform(url);

  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("downloads").insert({
        source_url: url,
        platform: platform.id,
        title: title ?? null,
        format: kind,
        status: "completed",
      });
    } catch {
      /* analytics must never affect the download */
    }
  })();
}
