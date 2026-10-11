import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { confirmSubPayment } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscription", robots: { index: false, follow: false } };

/**
 * /sub/return — where Paystack sends a subscriber back. The payment is verified
 * with Paystack HERE (never from the URL), then settled in the database; only a
 * verified, settled payment sends them on to the post they wanted. A failed,
 * cancelled or still-pending payment unlocks nothing and says so.
 */
export default async function SubReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const nextRaw = typeof sp.next === "string" ? sp.next : "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/sub/return?ref=${ref}&next=${next}`)}`);
  const out = await confirmSubPayment(ref);
  if (out.status === "paid") redirect(next);
  const copy =
    out.status === "pending"
      ? { title: "Confirming your payment…", line: "Paystack hasn't confirmed it yet. Nothing is unlocked until it does. This usually takes a moment." }
      : out.status === "mismatch"
        ? { title: "We couldn't match that payment", line: "The amount paid doesn't match the subscription, so nothing was unlocked. Our team has been alerted." }
        : { title: "The payment didn't go through", line: "Nothing was charged for this subscription and nothing was unlocked. You can try again." };
  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
      <p className="mt-2 text-[14.5px] text-muted-foreground">{copy.line}</p>
      <div className="mt-6 flex justify-center gap-2">
        {out.status === "pending" ? (
          <Link href={`/sub/return?ref=${encodeURIComponent(ref)}&next=${encodeURIComponent(next)}`} prefetch={false} className="inline-flex min-h-[2.75rem] items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition active:scale-[0.97]">
            Check again
          </Link>
        ) : null}
        <Link href={next} prefetch={false} className="inline-flex min-h-[2.75rem] items-center rounded-full border border-border px-5 text-[14px] font-semibold transition active:scale-[0.97]">
          Back
        </Link>
      </div>
    </div>
  );
}
