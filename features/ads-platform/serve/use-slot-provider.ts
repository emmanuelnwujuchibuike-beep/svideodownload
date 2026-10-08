"use client";

import { useCallback, useEffect, useState } from "react";

import { loadAdInventory } from "@/features/monetization/ad-inventory-client";
import { useShowAds } from "@/features/monetization/use-show-ads";
import type { AdPageContext } from "@/lib/ads-platform/catalog";
import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { providerOrder, resolveSlotProvider, slotById, type SlotProvider } from "@/lib/ads-platform/slot-registry";
import { mayServeSelf, mayServeSlot } from "@/lib/monetization/ad-inventory-shape";

export type SlotState =
  | { status: "pending" }
  | { status: "ready"; provider: "frenzsave"; ads: EligibleAd[]; rules: FormatRules | null }
  | { status: "ready"; provider: "network" | null };

/**
 * ONE physical slot → ONE provider (docs/AD_PLATFORM_PART5_SLOTS_ADDENDUM.md).
 *
 * The existing container calls this and mounts ONLY what it answers:
 *   · "frenzsave" → the paid campaign's creative, in this container
 *   · "network"   → the container's existing network unit, exactly as before
 *   · null        → nothing (the container collapses as it always did)
 *
 * Deciding is cheap and loads no provider. The shared inventory (one CDN
 * answer the network units already wait for) says which zones can fill and
 * whether ANY paid campaign is live; only then is the paid engine fetched
 * (`paid-runtime`, a dynamic import) to read the cached payload. With no
 * live campaign that chunk is never downloaded. The order is the admin's
 * (`ad_slot_provider_order` in the payload), else the registry default; when
 * the network unit reports it did not fill, `networkEmpty()` hands the slot on.
 */
export function useSlotProvider(slotId: string, page: AdPageContext | null): { state: SlotState; networkEmpty: () => void } {
  const { showAds, ready } = useShowAds();
  const [state, setState] = useState<SlotState>({ status: "pending" });
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const slot = slotById(slotId);
    if (!showAds || !slot) {
      setState({ status: "ready", provider: null });
      return;
    }
    let alive = true;
    let off: (() => void) | null = null;
    const resolve = async () => {
      const inv = await loadAdInventory();
      const network = slot.networkZone ? mayServeSlot(inv, slot.networkZone) : false;
      let ads: EligibleAd[] = [];
      let rules: FormatRules | null = null;
      let configured: Record<string, unknown> | undefined;
      if (slot.paidPlacement && mayServeSelf(inv)) {
        const rt = await import("./paid-runtime");
        const payload = await rt.loadSelfAds();
        const pool = rt.poolFor(payload, slot.paidPlacement, page);
        ads = pool.ads.filter((a) => rt.creativeFitsSlot(slot, a.w, a.h));
        rules = pool.rules;
        configured = payload?.order;
        // a creative that fails anywhere this session leaves every slot at once
        off ??= rt.onCreativeFailed(() => void resolve().catch(() => {}));
      }
      if (!alive) return;
      const order: SlotProvider[] = providerOrder(slot, configured);
      const pick = resolveSlotProvider(order, { frenzsave: ads.length > 0, network, networkEmpty: empty });
      setState(pick === "frenzsave" ? { status: "ready", provider: "frenzsave", ads, rules } : { status: "ready", provider: pick });
    };
    resolve().catch(() => {
      // the ad layer failing must never take the network unit with it
      if (alive) setState({ status: "ready", provider: slot.networkZone && !empty ? "network" : null });
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [ready, showAds, slotId, page, empty]);

  const networkEmpty = useCallback(() => setEmpty(true), []);
  return { state, networkEmpty };
}
