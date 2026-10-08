"use client";

import { BadgeCheck, CalendarClock, CircleAlert, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiButtonLink } from "@/features/ai/design/ai-button";
import { AiPanel } from "@/features/ai/design/ai-surface";
import { useUser } from "@/features/auth/use-user";
import { adMessage } from "@/lib/ads-platform/messages";
import { formatMoney } from "@/lib/ads-platform/offer";

import { Notice, Row } from "./advertise-ui";

/**
 * Back from the hosted checkout. The redirect proves NOTHING: this page asks
 * the server, which reads our ledger and - while the payment is pending -
 * asks the provider itself. The webhook may land before or after; both end in
 * the same settle, so the answer converges.
 *
 * Not a polling loop: a handful of checks on a widening backoff while the
 * answer is genuinely in flight (0 · 2 · 4 · 8 · 15 · 30 s), then it stops and
 * offers a manual "Check again". No setInterval, no Realtime.
 */

const BACKOFF_MS = [0, 2_000, 4_000, 8_000, 15_000, 30_000];

interface View {
  reference: string;
  provider: string;
  state: "verifying" | "paid" | "activating" | "live" | "failed" | "cancelled" | "expired" | "review" | "refunded" | "chargeback";
  paymentStatus: string;
  amountUsdCents: number;
  providerAmount: number | null;
  providerCurrency: string | null;
  campaigns: { id: string; name: string; status: string; startAt: string | null; endAt: string | null; durationDays: number | null; extraDays: number; placement: string | null; format: string | null }[];
}

const SETTLING: View["state"][] = ["verifying", "paid", "activating"];
const FORMAT_LABEL: Record<string, string> = { TOP_BANNER: "Top banner", CONTENT_BANNER: "Content banner", DOWNLOAD_RESULT_BANNER: "Download result banner", INTERSTITIAL: "Interstitial", DOWNLOAD_COMPLETED_INTERSTITIAL: "Download completed interstitial", REWARD_VIDEO: "Reward video" };
const date = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function readReference(): string | null {
  if (typeof window === "undefined") return null;
  const r = new URLSearchParams(window.location.search).get("reference");
  return r && r.length <= 120 ? r : null;
}

export function PaymentReturn() {
  const { user, loading } = useUser();
  const [reference, setReference] = useState<string | null | undefined>(undefined);
  useEffect(() => setReference(readReference()), []);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    if (!reference) return null;
    try {
      const res = await fetch(`/api/ads/payment/${encodeURIComponent(reference)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as (View & { error?: string; message?: string }) | null;
      if (!res.ok || !json) {
        setError(json?.message ?? adMessage("server"));
        return null;
      }
      setError(null);
      setView(json);
      return json;
    } catch {
      setError("You appear to be offline. Your payment is safe — check again when you're back online.");
      return null;
    } finally {
      setChecks((n) => n + 1);
    }
  }, [reference]);

  // the bounded backoff: only while the answer is in flight
  useEffect(() => {
    if (!user || !reference) return;
    let i = 0;
    let cancelled = false;
    const step = async () => {
      const v = await check();
      i += 1;
      if (cancelled || (v && !SETTLING.includes(v.state)) || i >= BACKOFF_MS.length) return;
      timer.current = setTimeout(() => void step(), BACKOFF_MS[i]);
    };
    void step();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [user, reference, check]);

  useEffect(() => {
    if (view?.state === "live") {
      try {
        sessionStorage.removeItem("frenz.advertise.form.v1");
      } catch {
        /* nothing to clear */
      }
    }
  }, [view?.state]);

  if (reference === undefined) return <div aria-busy className="h-40 animate-pulse rounded-[1.75rem] bg-slate-100" />;
  if (!reference) return <Notice icon={CircleAlert} tone="rose">{adMessage("payment_not_found")}</Notice>;
  if (!loading && !user) {
    return (
      <AiPanel className="text-center">
        <p className="text-[15px] font-semibold">Sign in to see your payment</p>
        <Link href={`/login?next=${encodeURIComponent(`/advertise/payment?reference=${reference}`)}`} prefetch={false} className="ai-btn ai-btn--primary mt-4 inline-flex">
          Sign in
        </Link>
      </AiPanel>
    );
  }

  const state = view?.state ?? "verifying";
  const gaveUp = SETTLING.includes(state) && checks >= BACKOFF_MS.length;
  const title: Record<View["state"], string> = {
    verifying: "Verifying your payment…",
    paid: "Payment successful",
    activating: "Payment verified — activating your campaign…",
    live: "Your campaign is live",
    failed: "Payment failed",
    cancelled: "Payment cancelled",
    expired: "Checkout expired",
    review: "We're checking your campaign",
    refunded: "Payment refunded",
    chargeback: "Payment disputed",
  };

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${state === "live" ? "bg-emerald-50 text-emerald-600" : ["failed", "cancelled", "expired", "chargeback"].includes(state) ? "bg-rose-50 text-rose-600" : "bg-indigo-50 text-indigo-600"}`} aria-hidden>
          {state === "live" ? <BadgeCheck className="h-6 w-6" /> : SETTLING.includes(state) && !gaveUp ? <LoaderCircle className="h-6 w-6 animate-spin" /> : state === "review" ? <ShieldCheck className="h-6 w-6" /> : <CircleAlert className="h-6 w-6" />}
        </span>
        <div className="min-w-0" role="status" aria-live="polite">
          <h1 className="font-brand text-[1.5rem] font-bold leading-tight tracking-[-0.03em]">{title[state]}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {state === "verifying" && (gaveUp ? "Your bank or the payment provider is still confirming. Nothing is lost — this page and your campaign update as soon as they confirm." : "We're confirming the payment directly with the payment provider.")}
            {state === "paid" || state === "activating" ? "Checking your campaign…" : null}
            {state === "live" ? "People can now see your ad on Frenzsave." : null}
            {state === "failed" ? "No money was taken for your campaign. You can try again." : null}
            {state === "cancelled" ? "You left the checkout before paying. Your ad is saved — you can pay whenever you're ready." : null}
            {state === "expired" ? "The checkout timed out before payment. Your ad is saved — start a new payment to continue." : null}
            {state === "review" ? "Your payment is safe. Something needs a quick check before your campaign goes live — we'll take it from here." : null}
            {state === "refunded" ? "This payment was refunded, and the campaign was handled under our refund rules." : null}
            {state === "chargeback" ? "This payment is under dispute, so the campaign is paused." : null}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Notice icon={CircleAlert} tone="rose">
            {error}
          </Notice>
        </div>
      ) : null}

      {view ? (
        <AiPanel className="mt-5">
          <Row label="Payment" value={view.paymentStatus === "success" ? "Paid" : view.paymentStatus.replace(/_/g, " ")} />
          <Row label="Amount" value={`${formatMoney(view.amountUsdCents, "USD")}${view.providerCurrency && view.providerCurrency !== "USD" && view.providerAmount !== null ? ` (${formatMoney(view.providerAmount, view.providerCurrency as "NGN")})` : ""}`} />
          {view.campaigns.map((c) => (
            <div key={c.id} className="mt-2 border-t border-slate-100 pt-2">
              <Row label="Campaign" value={c.name} />
              <Row label="Status" value={c.status === "active" ? "LIVE" : c.status.replace(/_/g, " ")} />
              <Row label="Format" value={c.format ? FORMAT_LABEL[c.format] ?? c.format : "—"} />
              <Row label="Placement" value={c.placement ?? "—"} />
              <Row label="Duration" value={c.durationDays ? `${c.durationDays} days` : "—"} />
              {c.extraDays ? <Row label="Bonus" value={`+${c.extraDays} days`} /> : null}
              {c.durationDays ? <Row label="Total runtime" value={`${c.durationDays + c.extraDays} days`} /> : null}
              <Row label="Starts" value={date(c.startAt)} />
              <Row label="Ends" value={date(c.endAt)} />
            </div>
          ))}
        </AiPanel>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2.5">
        {gaveUp || state === "review" ? (
          <button type="button" onClick={() => void check()} className="ai-btn ai-btn--secondary inline-flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" aria-hidden /> Check again
          </button>
        ) : null}
        {["failed", "cancelled", "expired"].includes(state) ? <AiButtonLink href="/advertise/create" prefetch={false}>Try again</AiButtonLink> : null}
        <AiButtonLink href="/advertise/campaigns" prefetch={false} variant={state === "live" ? "primary" : "secondary"} icon={<CalendarClock className="h-4 w-4" />}>
          My campaigns
        </AiButtonLink>
      </div>
    </div>
  );
}
