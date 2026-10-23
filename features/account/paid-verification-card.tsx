"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Paying for the blue tick (0268, owner 2026-10-22). The offer — price and period — is the admin's; the
 * tick comes only from Paystack's verified charge (lib/social/paid-verification.ts). Coming back from the
 * checkout (`?paid=<reference>`) this asks the server to settle that reference — the webhook may already
 * have — then reloads the page's server data.
 */
export function PaidVerificationCard({
  priceCents,
  periodDays,
  verified,
  paidUntil,
}: {
  priceCents: number;
  periodDays: number;
  /** Verified BY a payment (a reviewed or admin-issued tick shows no card). */
  verified: boolean;
  paidUntil: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"idle" | "checking" | "pending" | "failed">("idle");
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    const ref = new URLSearchParams(window.location.search).get("paid");
    if (!ref) return;
    asked.current = true;
    setConfirming("checking");
    let tries = 0;
    const ask = async () => {
      tries++;
      const res = await fetch("/api/verification/paid/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: ref }) }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { status?: string } | null;
      if (json?.status === "paid") {
        window.history.replaceState(null, "", window.location.pathname);
        setConfirming("idle");
        router.refresh();
        return;
      }
      if (json?.status === "failed" || json?.status === "unknown") {
        setConfirming("failed");
        return;
      }
      // a bank transfer or USSD payment can take a moment: ask again a few times, then say so
      if (tries < 6) window.setTimeout(() => void ask(), 4000);
      else setConfirming("pending");
    };
    void ask();
  }, [router]);

  const pay = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/verification/paid", { method: "POST" });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) {
        setProblem(json?.error ?? "Couldn't open the payment. Try again.");
        setBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch {
      setProblem("Couldn't reach the server. Check your connection.");
      setBusy(false);
    }
  };

  const price = `$${(priceCents / 100).toFixed(2)}`;
  const term = periodDays > 0 ? `for ${periodDays} day${periodDays === 1 ? "" : "s"}` : "for good";

  if (confirming === "checking") {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-3xl border border-blue-500/25 bg-blue-500/5 p-4 text-sm" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500 motion-reduce:animate-none" aria-hidden />
        Confirming your payment…
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-transparent to-violet-500/10 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
          <BadgeCheck className="h-6 w-6 fill-blue-500 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {verified ? (
            <>
              <p className="m-0 text-[15px] font-bold">Your paid verification is active</p>
              <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                {paidUntil ? `Until ${new Date(paidUntil).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. Renew any time — the days add on.` : "It lasts for good."}
              </p>
            </>
          ) : (
            <>
              <p className="m-0 text-[15px] font-bold">Get verified now</p>
              <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                Skip the application: the blue tick {term} for {price}, charged in your local currency at today&apos;s rate.
              </p>
            </>
          )}
          {confirming === "pending" ? <p className="m-0 mt-2 text-[12.5px] text-amber-700">Your payment is still being confirmed. The tick appears as soon as it clears — you can leave this page.</p> : null}
          {confirming === "failed" ? <p className="m-0 mt-2 text-[12.5px] text-rose-600">That payment didn&apos;t go through. Nothing was granted — you can try again.</p> : null}
          {problem ? <p className="m-0 mt-2 text-[12.5px] text-rose-600">{problem}</p> : null}
          {!verified || paidUntil ? (
            <button type="button" onClick={() => void pay()} disabled={busy} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-blue-600 px-5 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {verified ? `Renew · ${price}` : `Pay ${price}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
