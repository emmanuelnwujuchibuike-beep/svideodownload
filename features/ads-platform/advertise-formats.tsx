"use client";

import { useEffect, useState } from "react";

import { formatMoney, formatSpecs, fromPrice, offeredFormats, type AdCatalog } from "@/lib/ads-platform/offer";

import { Chip, formatIcon, IconChip } from "./advertise-ui";
import { loadAdCatalog } from "./catalog-client";

/**
 * The formats an advertiser can book RIGHT NOW, on the public /advertise page —
 * read from the admin's configuration (one cached Postgres read, shared with
 * the application), never a hard-coded list. Rendered after the page is
 * usable; the static page around it paints first.
 */
export function AdvertiseFormats() {
  const [cat, setCat] = useState<AdCatalog | null | undefined>(undefined);
  useEffect(() => {
    void loadAdCatalog().then(setCat);
  }, []);

  if (cat === undefined) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-32 animate-pulse rounded-[1.4rem] bg-slate-100" />
        ))}
      </div>
    );
  }
  const formats = cat ? offeredFormats(cat) : [];
  if (!cat || formats.length === 0) {
    return <p className="rounded-[1.4rem] bg-slate-50 p-5 text-[14px] text-muted-foreground">Ad formats open for booking soon.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {formats.map((f) => {
        const from = fromPrice(cat, f.code);
        return (
          <li key={f.code} className="flex gap-3.5 rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07]">
            <IconChip icon={formatIcon(f.code)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold">{f.name}</p>
                {from !== null ? <span className="whitespace-nowrap text-[12px] font-semibold text-muted-foreground">from {formatMoney(from, cat.settings.display_currency)}</span> : null}
              </div>
              {f.description ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{f.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {formatSpecs(f).map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
