import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/features/ads-platform/serve/use-slot-provider", () => ({ useSlotProvider: () => ({ state: { status: "pending" } }) }));

import type { SlotState } from "@/features/ads-platform/serve/use-slot-provider";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";

import { withGridAds } from "./history-grid-self-ads";

const tiles = (n: number): ReactNode[] => Array.from({ length: n }, (_, i) => <i key={i} />);
const ad = { c: "c", cr: "cr", sponsor: "S" } as EligibleAd;
const live: SlotState = { status: "ready", provider: "frenzsave", ads: [ad], rules: null };
const isAd = (x: ReactNode) => isValidElement<{ "data-ad-slot"?: string }>(x) && x.props["data-ad-slot"] === "history_grid";

describe("History grid: one paid square in every 4", () => {
  it("puts an ad after every 3 downloads", () => {
    const out = withGridAds(tiles(9), live);
    expect(out).toHaveLength(12);
    expect(out.map((x, i) => (isAd(x) ? i : -1)).filter((i) => i >= 0)).toEqual([3, 7, 11]);
  });

  it("a short section gets no ad until it has 3 downloads", () => {
    expect(withGridAds(tiles(2), live).some(isAd)).toBe(false);
    expect(withGridAds(tiles(5), live).filter(isAd)).toHaveLength(1);
  });

  it("nothing without a live paid campaign — no empty square", () => {
    expect(withGridAds(tiles(9), { status: "pending" })).toHaveLength(9);
    expect(withGridAds(tiles(9), { status: "ready", provider: null })).toHaveLength(9);
    expect(withGridAds(tiles(9), { status: "ready", provider: "frenzsave", ads: [], rules: null })).toHaveLength(9);
  });
});
