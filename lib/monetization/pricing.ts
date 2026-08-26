import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Editable display pricing for the /pricing page. Stored in the `settings` table
 * (key `pricing`) so an admin can change the shown prices without a redeploy.
 * NOTE: this is the DISPLAYED price only — the amount actually charged is set on
 * the Paystack plan. Keep them in sync.
 */

export interface PricingTier {
  name: string;
  price: string; // includes currency symbol, e.g. "$4.99" or "₦2,500"
  period: string; // e.g. "/mo"
}
export interface Pricing {
  pro: PricingTier;
  business: PricingTier;
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export const DEFAULT_PRICING: Pricing = {
  pro: {
    name: "Pro",
    price: process.env.PRICE_DISPLAY_PRO || "$4.99",
    period: "/mo",
  },
  business: {
    name: "Business",
    price: process.env.PRICE_DISPLAY_BUSINESS || "$9.99",
    period: "/mo",
  },
};

/**
 * The admin editor (features/admin/pricing-editor.tsx) is a bare text input
 * with no format validation, so a price typed without its symbol — "4.99"
 * instead of "$4.99" — is stored exactly as typed and renders on /pricing
 * looking like a broken currency (found via screenshot review, 2026-08-26).
 *
 * Only normalizes a value that starts with a DIGIT — the actual shape of that
 * bug. A price already carrying a symbol (`$4.99`, `₦2,500` — the docblock
 * above explicitly allows non-`$` currencies) is left exactly as entered.
 */
function normalizePrice(price: string): string {
  return /^\d/.test(price) ? `$${price}` : price;
}

export async function getPricing(): Promise<Pricing> {
  if (!hasSupabase) return DEFAULT_PRICING;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "pricing")
      .maybeSingle();
    const v = (data?.value ?? null) as Partial<Pricing> | null;
    if (!v) return DEFAULT_PRICING;
    const merged = {
      pro: { ...DEFAULT_PRICING.pro, ...(v.pro ?? {}) },
      business: { ...DEFAULT_PRICING.business, ...(v.business ?? {}) },
    };
    return {
      pro: { ...merged.pro, price: normalizePrice(merged.pro.price) },
      business: {
        ...merged.business,
        price: normalizePrice(merged.business.price),
      },
    };
  } catch {
    return DEFAULT_PRICING;
  }
}

export async function setPricing(p: Pricing): Promise<void> {
  const db = createAdminClient();
  await db
    .from("settings")
    .upsert({ key: "pricing", value: p }, { onConflict: "key" });
}
