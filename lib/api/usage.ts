import { trackEvent } from "@/lib/analytics/events";
import { createAdminClient } from "@/lib/supabase/admin";

const today = () => new Date().toISOString().slice(0, 10);

/** Today's request count for a single key. */
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

/**
 * Today's request count for a USER across ALL their keys — this is what the
 * daily quota is enforced against, so a user can't multiply their cap by
 * creating extra keys.
 */
export async function dailyUsageByUser(userId: string): Promise<number> {
  try {
    const supabase = createAdminClient();
    const { count } = await supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
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
