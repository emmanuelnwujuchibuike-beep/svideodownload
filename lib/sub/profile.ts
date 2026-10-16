import "server-only";

import type { SubTabData } from "@/features/profile/profile-tabs";
import { subscriptionCharge } from "@/lib/creator/membership/engine";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { createAdminClient } from "@/lib/supabase/admin";

import { isUuid } from "./guards";
import { getSubSettings, subConfig } from "./server";

/**
 * The profile's EXCLUSIVE tab data (moved out of app/u/[handle]/page.tsx in Frenz Exclusive
 * Part 4 so its rules can be tested). One settings read, one config read, and — for a signed-in
 * visitor only — one block read.
 *
 *  · The creator always gets the tab: it holds "Get paid for your content" before they go live,
 *    and their studio after.
 *  · A visitor gets it only once the creator is live (active, priced, purchases on). A creator
 *    without subscriptions shows no tab at all — never their settings.
 *  · A visitor who blocked the creator gets no tab (checkout refuses a blocked pair anyway). A
 *    creator who blocked the visitor, or a suspended creator, never reaches here: the profile
 *    itself is a 404 (lib/social/profile.ts).
 *  · A creator under an admin hide (friends-only, 0082) keeps the tab for the friends who can see
 *    the profile — their existing subscribers still read what they paid for — but offers no new
 *    subscription (quote null), because checkout refuses a hidden creator.
 *  · The quote is the server's: price + the platform fee, the same numbers checkout charges.
 */
export async function subTabFor(creatorId: string, creatorName: string, viewerId: string | null, owner: boolean): Promise<SubTabData | null> {
  try {
    if (!isUuid(creatorId)) return null;
    const db = createAdminClient();
    const visitor = !owner && !!viewerId && isUuid(viewerId);
    const [settings, cfg, creatorR, blockR] = await Promise.all([
      getSubSettings(creatorId),
      subConfig(),
      owner ? Promise.resolve({ data: null }) : db.from("profiles").select("is_suspended, is_hidden").eq("id", creatorId).maybeSingle(),
      visitor ? db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${viewerId},blocked_id.eq.${creatorId}),and(blocker_id.eq.${creatorId},blocked_id.eq.${viewerId})`).limit(1) : Promise.resolve({ data: [] as unknown[], error: null }),
    ]);
    if (!settings.ready) return null;
    const bounds = { minPriceCents: cfg.minPriceCents, maxPriceCents: cfg.maxPriceCents, purchaseFeePercent: cfg.purchaseFeePercent, withdrawalFeePercent: cfg.withdrawalFeePercent };
    const live = settings.active && !!settings.priceCents && cfg.purchasesEnabled;
    if (!owner) {
      if (!live) return null;
      // a failed block read is treated as blocked: a non-critical tab, so it fails closed
      if (blockR.error || (blockR.data ?? []).length) return null;
      const creator = creatorR.data as { is_suspended?: boolean; is_hidden?: boolean } | null;
      if (!creator || creator.is_suspended) return null;
      const offering = isAccountVisibleTo(flagsOf(creator), "stranger");
      const c = offering && settings.priceCents ? subscriptionCharge(settings.priceCents, cfg.purchaseFeePercent) : null;
      return {
        creatorName,
        signedIn: !!viewerId,
        bounds,
        quote: c ? { priceCents: c.priceCents, feeCents: c.feeCents, totalCents: c.totalCents, feePercent: cfg.purchaseFeePercent, periodDays: cfg.periodDays } : null,
        settings: null,
      };
    }
    const c = live && settings.priceCents ? subscriptionCharge(settings.priceCents, cfg.purchaseFeePercent) : null;
    return {
      creatorName,
      signedIn: !!viewerId,
      bounds,
      quote: c ? { priceCents: c.priceCents, feeCents: c.feeCents, totalCents: c.totalCents, feePercent: cfg.purchaseFeePercent, periodDays: cfg.periodDays } : null,
      settings: { priceCents: settings.priceCents, active: settings.active, setupStep: settings.setupStep, setupCompleted: settings.setupCompleted, promoDismissed: settings.promoDismissed, notifySubscribed: settings.notifySubscribed },
    };
  } catch {
    // a non-critical read: no tab beats a broken profile
    return null;
  }
}
