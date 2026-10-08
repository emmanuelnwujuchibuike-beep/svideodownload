import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { PaymentReturn } from "@/features/ads-platform/payment-return";

/*
  Static: no cookie, no query read on the server - the browser reads
  ?reference= and asks /api/ads/payment/[reference] for the truth. A return
  from checkout costs no page render.
*/
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Your ad payment — Frenzsave", robots: { index: false, follow: false } };

export default function AdPaymentPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-[calc(var(--frenz-safe-top)+5rem)] sm:pt-[calc(var(--frenz-safe-top)+6.5rem)]">
          <PaymentReturn />
        </div>
      </main>
    </>
  );
}
