import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Unified, fire-and-forget analytics. Every monetization subsystem funnels
 * through `trackEvent` (the `events` table) plus, where useful, a dedicated
 * counter table. Never throws, never blocks the request.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type EventType =
  | "download"
  | "ad_impression"
  | "ad_click"
  | "affiliate_click"
  | "subscribe"
  | "subscribe_cancel"
  | "api_call"
  | "api_key_created"
  | "upgrade_prompt_view"
  | "pwa_install_prompt_shown"
  | "pwa_install_accepted"
  | "pwa_install_dismissed"
  | "pwa_installed"
  // Experiment platform: one row per enrolled exposure, metadata { experiment, variant }.
  | "experiment_exposure";

interface EventInput {
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export function trackEvent(type: EventType, input: EventInput = {}): void {
  if (!hasSupabase) return;
  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("events").insert({
        type,
        user_id: input.userId ?? null,
        metadata: input.metadata ?? {},
      });
    } catch {
      /* analytics must never affect the request */
    }
  })();
}

/** Records an ad impression (dedicated counter + unified event). */
export function recordAdImpression(
  zone: string,
  adId: string | null,
  userId?: string | null,
): void {
  if (!hasSupabase) return;
  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("ad_impressions").insert({ zone, ad_id: adId, user_id: userId ?? null });
    } catch {
      /* ignore */
    }
  })();
  trackEvent("ad_impression", { userId, metadata: { zone, adId } });
}

/** Records an ad click (dedicated counter + unified event). */
export function recordAdClick(
  zone: string,
  adId: string | null,
  userId?: string | null,
): void {
  if (!hasSupabase) return;
  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("ad_clicks").insert({ zone, ad_id: adId, user_id: userId ?? null });
    } catch {
      /* ignore */
    }
  })();
  trackEvent("ad_click", { userId, metadata: { zone, adId } });
}

/** Records an affiliate click (dedicated funnel table + unified event). */
export function recordAffiliateClick(
  offerId: string,
  ctx: { userId?: string | null; country?: string | null; device?: string | null },
): void {
  if (!hasSupabase) return;
  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("affiliate_clicks").insert({
        offer_id: offerId,
        user_id: ctx.userId ?? null,
        country: ctx.country ?? null,
        device: ctx.device ?? null,
      });
    } catch {
      /* ignore */
    }
  })();
  trackEvent("affiliate_click", {
    userId: ctx.userId,
    metadata: { offerId, country: ctx.country, device: ctx.device },
  });
}
