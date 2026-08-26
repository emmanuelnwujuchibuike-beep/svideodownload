import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * 🔴 Found via screenshot review of the pricing page, 2026-08-26: the admin
 * pricing editor (features/admin/pricing-editor.tsx) is a bare text input
 * with no format validation. A price typed as "4.99" instead of "$4.99" was
 * stored and rendered exactly that way — "4.99/mo" beside Pro's correctly
 * formatted "$1.99/mo" on the live page.
 */
describe("getPricing — normalizes a bare numeric price", () => {
  it("prepends $ to a digit-led price with no symbol", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  value: {
                    pro: { price: "1.99" },
                    business: { price: "4.99" },
                  },
                },
              }),
            }),
          }),
        }),
      }),
    }));
    const { getPricing } = await import("./pricing");
    const p = await getPricing();
    expect(p.pro.price).toBe("$1.99");
    expect(p.business.price).toBe("$4.99");
  });

  it("🔴 leaves an already-symbol-prefixed price untouched, including non-$ currencies", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  value: {
                    pro: { price: "$4.99" },
                    business: { price: "₦2,500" },
                  },
                },
              }),
            }),
          }),
        }),
      }),
    }));
    const { getPricing } = await import("./pricing");
    const p = await getPricing();
    expect(p.pro.price).toBe("$4.99");
    // Naira, not dollars — must not be clobbered into "$₦2,500".
    expect(p.business.price).toBe("₦2,500");
  });
});
