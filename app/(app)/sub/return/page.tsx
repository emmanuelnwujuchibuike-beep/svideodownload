import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { clientId, subVerifyLimiter } from "@/lib/rate-limit";
import { isSubReference, subReturnPath } from "@/lib/sub/guards";
import { confirmSubPayment, type SubConfirmStatus } from "@/lib/sub/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscription", robots: { index: false, follow: false } };

/**
 * /sub/return — where Paystack sends a subscriber back. The payment is verified
 * with Paystack HERE (never from the URL), then settled in the database; only a
 * verified, settled payment sends them on to the post they wanted. A failed,
 * cancelled or still-pending payment unlocks nothing and says so.
 *
 * Part 2 (2026-10-16):
 *  · `next` goes through `subReturnPath` (= `safeNext`): "/\evil.com" used to pass the old
 *    "starts with / but not //" check and a browser reads it as https://evil.com.
 *  · The verify call is rate-limited per IP and per reference, and a reference that is not
 *    one of ours never reaches Paystack (confirmSubPayment reads our own record first).
 *    A limited request is shown "still confirming": it unlocks nothing and costs nothing.
 */
export default async function SubReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" && isSubReference(sp.ref) ? sp.ref : "";
  const next = subReturnPath(sp.next);
  /*
    🔴 CONFIRM FIRST, sign-in second (2026-10-12). Paystack sends the payer back in the
    BROWSER, not the installed app, and there they are usually signed out. This page
    used to send them to /login BEFORE confirming, so a paid subscription stayed
    "initiated": no access, no creator earnings. Confirming needs no session — it asks
    Paystack about this reference and settles it in SQL, idempotently, to the
    subscriber the purchase was created for. A reference only ever settles a real,
    verified charge, so knowing one grants nothing.
  */
  let status: SubConfirmStatus = "unknown";
  if (ref) {
    const ip = clientId(await headers());
    const [byIp, byRef] = await Promise.all([subVerifyLimiter.limit(`sub-return:ip:${ip}`), subVerifyLimiter.limit(`sub-return:ref:${ref}`)]);
    status = byIp.success && byRef.success ? (await confirmSubPayment(ref)).status : "pending";
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const again = `/sub/return?ref=${encodeURIComponent(ref)}&next=${encodeURIComponent(next)}`;
  if (status === "paid") {
    if (user) redirect(next);
    return (
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">You&apos;re subscribed</h1>
        <p className="mt-2 text-[14.5px] text-muted-foreground">Your payment is confirmed and the posts are unlocked. Open Frenzsave to see them. If you use the app, switch back to it now.</p>
        <div className="mt-6 flex justify-center">
          <Link href={`/login?next=${encodeURIComponent(next)}`} prefetch={false} className="inline-flex min-h-[2.75rem] items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition active:scale-[0.97]">
            Sign in here instead
          </Link>
        </div>
      </div>
    );
  }
  if (!user) redirect(`/login?next=${encodeURIComponent(again)}`);
  const copy =
    status === "pending"
      ? { title: "Confirming your payment…", line: "Paystack hasn't confirmed it yet. Nothing is unlocked until it does. A bank transfer or USSD payment can take a few minutes." }
      : status === "mismatch"
        ? { title: "We couldn't match that payment", line: "The amount paid doesn't match the subscription, so nothing was unlocked. Our team has been alerted." }
        : status === "held"
          ? { title: "Your payment was received", line: "This creator removed you from their subscribers before the payment went through, so nothing was unlocked. The payment is recorded for a refund and our team will return it." }
          : { title: "The payment didn't go through", line: "Nothing was unlocked for this subscription. If you were charged, it will settle automatically once Paystack confirms it." };
  return (
    <div className="mx-auto w-full max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.title}</h1>
      <p className="mt-2 text-[14.5px] text-muted-foreground">{copy.line}</p>
      <div className="mt-6 flex justify-center gap-2">
        {status === "pending" && ref ? (
          <Link href={again} prefetch={false} className="inline-flex min-h-[2.75rem] items-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background transition active:scale-[0.97]">
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
