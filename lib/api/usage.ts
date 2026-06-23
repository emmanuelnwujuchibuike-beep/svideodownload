import { trackEvent } from "@/lib/analytics/events";
import { createAdminClient } from "@/lib/supabase/admin";

const today = () => new Date().toISOString().slice(0, 10);

/** Today's request count for a key (used for daily quota enforcement). */
export async function dailyUsage(keyId: string): Promise<number> {
  try {
    const supabase = createAdminClient();
    const { count } = await supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .eq("api_key_id", keyId)
      .eq("day", today());
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Meters a single API call (request count + bytes) — fire-and-forget. */
export function recordApiUsage(
  keyId: string,
  userId: string,
  endpoint: string,
  status: number,
  bytes = 0,
): void {
  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("api_usage").insert({
        api_key_id: keyId,
        user_id: userId,
        endpoint,
        status,
        bytes,
        day: today(),
      });
    } catch {
      /* metering must never break the API response */
    }
  })();
  trackEvent("api_call", { userId, metadata: { endpoint, status } });
}
