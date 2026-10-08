"use client";

import dynamic from "next/dynamic";

import type { AdPageContext } from "@/lib/ads-platform/catalog";

import { useSlotProvider } from "./use-slot-provider";

const SelfAdCard = dynamic(() => import("./self-ad-card").then((m) => m.SelfAdCard), { ssr: false });

/**
 * A registered slot with NO network unit (lib/ads-platform/slot-registry.ts —
 * `newInventory`): today the Frenz AI hub card. Renders NOTHING (no box, no
 * label, no gap) unless the resolver gives it a paid campaign; the card itself
 * is fetched only then.
 */
export function SelfAdSlot({ slot, placement, page, className }: { slot: string; placement: string; page: AdPageContext; className?: string }) {
  const { state } = useSlotProvider(slot, page);
  if (state.status !== "ready" || state.provider !== "frenzsave") return null;
  return (
    <div data-ad-slot={slot} data-ad-provider="frenzsave" className={className}>
      <SelfAdCard ads={state.ads} rules={state.rules} placement={placement} page={page} />
    </div>
  );
}
