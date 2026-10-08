import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Ad Platform Part 6 — the admin manages the canonical slots, never creates locations (shared-slot addendum §16/§60). */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const route = () => src("app/api/admin/ads/slots/route.ts");

describe("/api/admin/ads/slots", () => {
  it("is admin-only on both verbs", () => {
    expect(route().match(/const admin = await getAdminUser\(\);\n  if \(!admin\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\);/g)).toHaveLength(2);
  });

  it("lists exactly the registry — box and moment slots — and creates nothing", () => {
    const r = route();
    expect(r).toContain("const ALL: readonly SlotSpec[] = [...AD_SLOTS, ...MOMENT_SLOTS];");
    expect(r).not.toMatch(/\.insert\(/);
    expect(r).not.toMatch(/from\("ad_placements"\)[^;]*\.(update|upsert|insert)/);
  });

  it("an order is validated against the slot: no network on a paid-only slot, no paid on a network-only one", () => {
    const r = route();
    expect(r).toContain('if (!slot) return NextResponse.json({ error: "Unknown slot." }, { status: 400 });');
    expect(r).toContain('if (order.includes("network") && !slot.networkZone)');
    expect(r).toContain('if (order.includes("frenzsave") && !slot.paidPlacement)');
    expect(r).toContain('z.array(z.enum(["frenzsave", "network"])).min(1).max(2)');
  });

  it("is stored where the serving payload already reads it — one key, merged per slot", () => {
    const r = route();
    expect(r).toContain("AD_SLOT_PROVIDER_ORDER_KEY");
    expect(r).toContain("const next = { ...current, [slot.id]: order };");
    expect(src("lib/ads-platform/server.ts")).toContain('export const AD_SLOT_PROVIDER_ORDER_KEY = "ad_slot_provider_order";');
  });
});

describe("the panel lives in the EXISTING Ad placements tab", () => {
  it("is mounted inside AdManager (no new admin screen), and lazily", () => {
    const m = src("features/admin/ad-manager.tsx");
    expect(m).toContain("<AdSlotsPanelLazy />");
    expect(src("features/admin/ad-slots-panel-lazy.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/ad-slots-panel"\)/);
  });

  it("only offers orders the slot can actually have", () => {
    const p = src("features/admin/ad-slots-panel.tsx");
    expect(p).toContain('c.order.every((p) => (p === "network" ? !!s.networkZone : !!s.paidPlacement))');
  });
});
