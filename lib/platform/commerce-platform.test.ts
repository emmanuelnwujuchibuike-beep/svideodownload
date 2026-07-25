import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getBillingAndPromotions,
  getCommerceAi,
  getCommerceServices,
  getCommerceTypes,
  getPaymentCapabilities,
  getSubscriptionTiers,
  type CommerceStatus,
} from "./commerce-platform";

/**
 * Keeps the Commerce Registry honest (docs/CONSTITUTION.md, Article I.3): a
 * `live`/`partial` row must point at a file that exists, and a `planned` row must
 * not pretend to. Financial infrastructure is exactly where an overstated "live"
 * would be most damaging, so the truth rule is enforced mechanically.
 */

const ROOT = path.resolve(__dirname, "../..");

function sourceProblems(entries: { id: string; source: string; status: CommerceStatus }[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else if (!e.source) {
      problems.push(`"${e.id}" is ${e.status} but names no source`);
    } else if (!existsSync(path.join(ROOT, e.source))) {
      problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
    }
  }
  return problems;
}

const CATALOGUES: Record<string, { id: string; source: string; status: CommerceStatus }[]> = {
  services: getCommerceServices(),
  payments: getPaymentCapabilities(),
  "subscription tiers": getSubscriptionTiers(),
  "billing & promotions": getBillingAndPromotions(),
  AI: getCommerceAi(),
};

describe("Commerce Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("every live/partial commerce type is powered by a declared service; planned name none", () => {
    const serviceIds = new Set(getCommerceServices().map((s) => s.id));
    const seen = new Set<string>();
    for (const t of getCommerceTypes()) {
      expect(seen.has(t.id), `duplicate type id "${t.id}"`).toBe(false);
      seen.add(t.id);
      if (t.status === "planned") {
        expect(t.poweredBy, `${t.id} is planned but names a service`).toBe("");
      } else {
        expect(serviceIds.has(t.poweredBy), `${t.id} → unknown service "${t.poweredBy}"`).toBe(true);
      }
    }
  });

  it("subscriptions + payments + analytics are live; marketplace/payouts/promotions stay planned", () => {
    const svc = new Map(getCommerceServices().map((s) => [s.id, s.status]));
    expect(svc.get("payments")).toBe("live");
    expect(svc.get("subscription")).toBe("live");
    expect(svc.get("analytics")).toBe("live");
    for (const planned of ["marketplace-tx", "payouts", "settlement", "invoice", "promotions", "fraud", "refunds"]) {
      expect(svc.get(planned), `${planned} should be planned`).toBe("planned");
    }
  });

  it("the three real plans are live and the AI layer is honestly planned", () => {
    const tiers = new Map(getSubscriptionTiers().map((t) => [t.id, t.status]));
    for (const real of ["free", "pro", "business"]) expect(tiers.get(real)).toBe("live");
    for (const ai of getCommerceAi()) expect(ai.status, `${ai.id} should be planned`).toBe("planned");
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/paystack/nope.ts", status: "live" }]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned row that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "fake", source: "lib/x.ts", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
  it("catches a live row with no source", () => {
    const problems = sourceProblems([{ id: "empty", source: "", status: "live" }]);
    expect(problems.some((p) => p.includes("names no source"))).toBe(true);
  });
});
