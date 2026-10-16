import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { PrintButton } from "@/features/sub/print-button";
import { myReceipt } from "@/lib/sub/subscriptions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receipt",
  robots: { index: false, follow: false },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }) : "—");

/**
 * One subscription payment (Frenz Exclusive Part 5), rendered on the server from the
 * subscriber's OWN sub_purchases row — another member's id answers 404 exactly like a missing
 * one. It is a receipt only when Paystack's charge was verified and settled on the server; an
 * open or unfinished checkout is shown as "not a receipt", whatever the browser was told.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/subscriptions/receipt/${id}`)}`);
  const tx = await myReceipt(user.id, id);
  if (!tx) notFound();

  const rows: [string, string][] = [
    ["Creator", tx.creator ? `${tx.creator.displayName} (@${tx.creator.handle})` : "A creator"],
    ["Status", tx.label],
    ["Date", fmt(tx.date)],
    ...(tx.charged ? ([["Amount charged", tx.charged]] as [string, string][]) : []),
    ["Subscription price", tx.breakdown.price],
    ["Service fee", tx.breakdown.fee],
    ["Total (USD)", tx.breakdown.total],
    ["Period", `${tx.periodDays} days`],
    ...(tx.periodStart && tx.periodEnd ? ([["Access", `${fmt(tx.periodStart)} – ${fmt(tx.periodEnd)}`]] as [string, string][]) : []),
    ...(tx.reversedAt ? ([["Refunded or reversed", fmt(tx.reversedAt)]] as [string, string][]) : []),
    ["Reference", tx.reference],
  ];

  return (
    <AppContent>
      <div className="mx-auto max-w-lg">
        <header className="mb-5 flex items-center gap-3 print:hidden">
          <Link href="/account/subscriptions" aria-label="Back to subscriptions" className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/80 transition hover:bg-secondary">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{tx.receipt ? "Receipt" : "Payment details"}</h1>
        </header>

        <article className="rounded-3xl border border-border/70 bg-card px-5 py-5 shadow-card print:border-0 print:shadow-none">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Frenzsave · Exclusive subscription</p>
          <p className="mt-1 text-[22px] font-extrabold tracking-[-0.02em]">{tx.charged ?? tx.breakdown.total}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{tx.note}</p>
          {!tx.receipt ? <p className="mt-3 rounded-2xl bg-muted px-3 py-2 text-[13px] font-medium">This is not a receipt: no payment was confirmed for this checkout.</p> : null}
          <dl className="mt-4 divide-y divide-border/70 text-[13.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11.5px] text-muted-foreground">Paid through Paystack. A subscription is one payment for its period and never renews automatically. Quote the reference above if you contact support.</p>
        </article>

        {tx.receipt ? <PrintButton className="mt-4 w-full justify-center print:hidden" /> : null}
      </div>
    </AppContent>
  );
}
