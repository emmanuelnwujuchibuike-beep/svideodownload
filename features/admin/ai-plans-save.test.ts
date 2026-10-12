import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// owner, 2026-10-12: "Couldn't save — frenzAiPlans.wallet.transfers: Unrecognized key(s) in object: 'depositedFeePercent'"
describe("every transfer setting the AI plans form sends is accepted by the server", () => {
  it("the strict transfers schema names each key the form sends", () => {
    const ui = readFileSync("features/admin/ai-plans-settings.tsx", "utf8");
    const route = readFileSync("app/api/admin/landing/route.ts", "utf8");
    const sent = ui.match(/transfers: \{ ([^}]+) \},/)?.[1] ?? "";
    const keys = [...sent.matchAll(/(\w+):/g)].map((m) => m[1]!);
    expect(keys).toContain("depositedFeePercent");
    const schema = route.match(/transfers: z\.object\(\{([^}]+)\}\)\.strict\(\)/)?.[1] ?? "";
    for (const k of keys) expect(schema, k).toContain(`${k}:`);
  });
});
