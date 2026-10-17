import { ArrowLeft, CreditCard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { SubscriptionsManager } from "@/features/sub/subscriptions-manager";
import { mySubscriptions, myTransactions } from "@/lib/sub/subscriptions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subscriptions",
  robots: { index: false, follow: false },
};

/** /account/subscriptions — the member's own paid subscriptions, cancellations and receipts (Frenz Exclusive Part 5). */
export default async function AccountSubscriptionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/subscriptions");
  const [subs, tx] = await Promise.all([mySubscriptions(user.id), myTransactions(user.id)]);

  return (
    <div className="ex-ground w-full flex-1">
      <AppContent>
        <div className="mx-auto max-w-2xl">
          <header className="mb-6 flex items-center gap-3">
            <Link href="/account" aria-label="Back to account" className="ex-icon-btn -ml-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
                <CreditCard className="h-6 w-6 text-muted-foreground" /> Subscriptions
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">Creators you subscribe to, your access dates and your receipts.</p>
            </div>
          </header>
          <SubscriptionsManager initial={subs.ok ? subs.items : null} initialTx={tx.ok ? { items: tx.items, next: tx.next } : null} />
        </div>
      </AppContent>
    </div>
  );
}
