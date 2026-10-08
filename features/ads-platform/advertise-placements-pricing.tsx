"use client";

import { Gift } from "lucide-react";
import { useEffect, useState } from "react";

import { formatMoney, priceFor, type AdCatalog } from "@/lib/ads-platform/offer";

import { Chip } from "./advertise-ui";
import { loadAdCatalog } from "./catalog-client";

/**
 * Where ads appear and what they cost, on the public /advertise page (Landing +
 * Download brief §12–§16, §43, owner 2026-10-08).
 *
 * Everything is the admin's live configuration from the same cached catalog
 * read the formats section and the application use (`loadAdCatalog` memoises
 * it, so this adds no request): only enabled placements, prices as set, a
 * promotion only while it is live. Nothing here is hard-coded, and the price
 * shown is "from" — the server confirms the exact total before payment.
 */
export function AdvertisePlacementsPricing() {
  const [cat, setCat] = useState<AdCatalog | null | undefined>(undefined);
  useEffect(() => {
    void loadAdCatalog().then(setCat);
  }, []);

  if (cat === undefined) {
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1].map((i) => (
          <span key={i} className="block h-28 animate-pulse rounded-[1.4rem] bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  }
  if (!cat || !cat.settings.ads_enabled) {
    return <p className="rounded-[1.4rem] bg-muted p-5 text-[14px] text-muted-foreground">Advertising opens soon.</p>;
  }

  const currency = cat.settings.display_currency;
  const formatName = new Map(cat.formats.map((f) => [f.code, f.name]));
  const placements = cat.placements.filter((p) => formatName.has(p.format_code));
  const now = Date.now();
  const livePromos = cat.promotions.filter((p) => !p.ends_at || Date.parse(p.ends_at) > now);

  /** Cheapest price of a placement across durations, or null when it is not priced yet. */
  const placementFrom = (code: string) => {
    const ps = cat.durations.map((d) => priceFor(cat, code, d.id)).filter((x): x is number => x !== null);
    return ps.length ? Math.min(...ps) : null;
  };
  /** Cheapest price for a duration across placements. */
  const durationFrom = (id: string) => {
    const ps = placements.map((p) => priceFor(cat, p.code, id)).filter((x): x is number => x !== null);
    return ps.length ? Math.min(...ps) : null;
  };
  const durationPromo = (id: string) =>
    livePromos
      .filter((p) => p.duration_id === null || p.duration_id === id)
      .sort((a, b) => b.extra_days - a.extra_days || b.discount_percent - a.discount_percent)[0] ?? null;
  const pricedDurations = cat.durations.filter((d) => durationFrom(d.id) !== null);

  return (
    <div className="space-y-10">
      <section aria-labelledby="placements">
        <h2 id="placements" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
          Where your ad appears
        </h2>
        <p className="mt-1.5 text-[14px] text-muted-foreground">Choose one place for your ad. Only places open for booking are shown.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {placements.map((p) => {
            const from = placementFrom(p.code);
            return (
              <li key={p.code} className="rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold">{p.name}</p>
                  {from !== null ? <span className="whitespace-nowrap text-[12px] font-semibold text-muted-foreground">from {formatMoney(from, currency)}</span> : null}
                </div>
                {p.description ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{p.description}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip>{formatName.get(p.format_code)}</Chip>
                  {from === null ? <Chip tone="amber">Booking soon</Chip> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="pricing">
        <h2 id="pricing" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
          Pricing and duration
        </h2>
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          You buy campaign time — your ad stays eligible to be shown for the days you choose. The exact total is confirmed before you pay.
        </p>
        {pricedDurations.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3">
            {pricedDurations.map((d) => {
              const promo = durationPromo(d.id);
              return (
                <li key={d.id} className="rounded-[1.3rem] bg-card p-3.5 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
                  <p className="text-[17px] font-bold tracking-[-0.02em]">{d.name}</p>
                  <p className="mt-1 text-[13px] font-semibold tabular-nums text-muted-foreground">from {formatMoney(durationFrom(d.id)!, currency)}</p>
                  {promo && (promo.extra_days > 0 || promo.discount_percent > 0) ? (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700 dark:text-emerald-300">
                      <Gift className="h-3 w-3" aria-hidden />
                      {promo.extra_days > 0 ? `+${promo.extra_days} bonus ${promo.extra_days === 1 ? "day" : "days"}` : `${promo.discount_percent}% off`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-[1.4rem] bg-muted p-5 text-[14px] text-muted-foreground">Prices are being set. You can prepare your ad now and save it as a draft.</p>
        )}
      </section>
    </div>
  );
}
