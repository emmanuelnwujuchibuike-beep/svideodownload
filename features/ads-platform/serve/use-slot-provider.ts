"use client";

import { useCallback, useEffect, useState } from "react";

import { loadAdInventory } from "@/features/monetization/ad-inventory-client";
import { useShowAds } from "@/features/monetization/use-show-ads";
import type { AdPageContext } from "@/lib/ads-platform/catalog";
import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { onCreativeFailed, poolFor } from "@/lib/ads-platform/serving-state";
import { creativeFitsSlot, providerOrder, resolveSlotProvider, slotById, type SlotProvider } from "@/lib/ads-platform/slot-registry";
import { mayServeSlot } from "@/lib/monetization/ad-inventory-shape";

import { loadSelfAds } from "../serving-client";

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
 * Deciding is cheap and loads no provider: the paid side reads the cached
 * payload (no request at all while no campaign is live — the shared inventory
 * says so), the network side reads the same shared inventory the network unit
 * consults before it asks. The order is the admin's (`ad_slot_provider_order`
 * in the payload), else the registry default. When the network unit reports
 * it did not fill, `networkEmpty()` hands the slot to the next provider.
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
    const resolve = () =>
      void Promise.all([slot.paidPlacement ? loadSelfAds() : Promise.resolve(null), loadAdInventory()])
        .then(([payload, inv]) => {
          if (!alive) return;
          const pool = slot.paidPlacement ? poolFor(payload, slot.paidPlacement, page) : { ads: [], rules: null };
          const ads = pool.ads.filter((a) => creativeFitsSlot(slot, a.w, a.h));
          const order: SlotProvider[] = providerOrder(slot, payload?.order);
          const network = slot.networkZone ? mayServeSlot(inv, slot.networkZone) : false;
          const pick = resolveSlotProvider(order, { frenzsave: ads.length > 0, network, networkEmpty: empty });
          setState(pick === "frenzsave" ? { status: "ready", provider: "frenzsave", ads, rules: pool.rules } : { status: "ready", provider: pick });
        })
        .catch(() => {
          // the ad layer failing must never take the network unit with it
          if (alive) setState({ status: "ready", provider: slot.networkZone && !empty ? "network" : null });
        });
    resolve();
    const off = onCreativeFailed(resolve);
    return () => {
      alive = false;
      off();
    };
  }, [ready, showAds, slotId, page, empty]);

  const networkEmpty = useCallback(() => setEmpty(true), []);
  return { state, networkEmpty };
}
