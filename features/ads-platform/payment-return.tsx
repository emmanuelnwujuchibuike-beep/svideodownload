"use client";

import { BadgeCheck, CalendarClock, Check, CircleAlert, Clock, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiButton, AiButtonLink } from "@/features/ai/design/ai-button";
import { AiPanel } from "@/features/ai/design/ai-surface";
import { useUser } from "@/features/auth/use-user";
import { adMessage } from "@/lib/ads-platform/messages";
import { formatMoney } from "@/lib/ads-platform/offer";
import { cn } from "@/lib/utils";

import { AdFlowRail, CampaignSummaryCard, Notice, Row, runtimeLabel } from "./advertise-ui";
import { TapOnceLink } from "@/features/ui/tap-once-link";

/**
 * Back from the hosted checkout. The redirect proves NOTHING: this page asks
 * the server, which reads our ledger and - while the payment is pending -
 * asks the provider itself. The webhook may land before or after; both end in
 * the same settle, so the answer converges. "Payment verified" and "Campaign
 * Live" are only ever the SERVER's words (owner brief §80.13–14).
 *
 * Not a polling loop: a handful of checks on a widening backoff while the
 * answer is genuinely in flight (0 · 2 · 4 · 8 · 15 · 30 s), then it stops and
 * offers "Check Payment Status". No setInterval, no Realtime. Leaving the page
 * cancels the pending timer AND the request in flight (§69).
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
  /** Part 6: this payment extends an existing campaign */
  extension?: { status: string; days: number; extraDays: number; newEndAt: string | null } | null;
}

const SETTLING: View["state"][] = ["verifying", "paid", "activating"];
const FORMAT_LABEL: Record<string, string> = { TOP_BANNER: "Top banner", CONTENT_BANNER: "Content banner", DOWNLOAD_RESULT_BANNER: "Download result banner", INTERSTITIAL: "Interstitial", DOWNLOAD_COMPLETED_INTERSTITIAL: "Download completed interstitial", REWARD_VIDEO: "Reward video" };
const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function readReference(): string | null {
  if (typeof window === "undefined") return null;
  const r = new URLSearchParams(window.location.search).get("reference");
  return r && r.length <= 120 ? r : null;
}

/**
 * What the advertiser reads. `verifying` is split three ways by the payment's
 * own status, because they ask different things of the person (§58):
 *   checking  — in flight; nothing to do
 *   pending   — the provider hasn't answered yet; do NOT pay again
 *   unverified — the outcome is uncertain on our side; check, don't pay twice
 */
type Tone = "progress" | "success" | "warn" | "error" | "info";
type Copy = { title: string; body: string; tone: Tone };

function copyFor(state: View["state"], paymentStatus: string | null, gaveUp: boolean): Copy {
  switch (state) {
    case "verifying":
      if (paymentStatus === "verification_required")
        return { title: "Payment could not be verified", body: "We couldn't confirm this payment yet. Your campaign has not been activated.", tone: "warn" };
      if (gaveUp)
        return { title: "Payment verification pending", body: "We're waiting for confirmation from the payment provider. You don't need to pay again yet.", tone: "warn" };
      return { title: "Verifying your payment", body: "We're confirming it directly with the payment provider. This usually takes a few seconds.", tone: "progress" };
    case "paid":
    case "activating":
      return { title: "Payment verified", body: "Your campaign is being activated.", tone: "progress" };
    case "live":
      return { title: "Campaign Live", body: "Your advertisement is now active.", tone: "success" };
    case "failed":
      return { title: "Payment failed", body: "Your campaign was not activated. No campaign credit was applied.", tone: "error" };
    case "cancelled":
      return { title: "Payment cancelled", body: "You left the checkout before paying. Your campaign was not activated and nothing was charged.", tone: "error" };
    case "expired":
      return { title: "Your payment session expired", body: "The campaign price or promotion may have changed.", tone: "warn" };
    case "review":
      return { title: "We're checking your campaign", body: "Your payment is safe. Something needs a quick check before your campaign goes live — we'll take it from here.", tone: "info" };
    case "refunded":
      return { title: "Payment refunded", body: "This payment was refunded, and the campaign was handled under our refund rules.", tone: "info" };
    case "chargeback":
      return { title: "Payment disputed", body: "This payment is under dispute, so the campaign is paused.", tone: "error" };
  }
}

/** Payment → Verification → Live, as three small marks (§56: a compact indicator, not a blocking animation). */
function Progress({ state }: { state: View["state"] }) {
  const at = state === "verifying" ? 1 : state === "paid" || state === "activating" ? 2 : 3;
  const items = ["Payment", "Verified", "Live"];
  return (
    <ol className="mt-4 flex items-center gap-2" aria-label="Payment progress">
      {items.map((label, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={label} className="flex min-w-0 items-center gap-2">
            {i > 0 ? <span className={cn("h-px w-5 shrink-0 sm:w-8", done || current ? "bg-indigo-300 dark:bg-indigo-400/50" : "bg-border")} aria-hidden /> : null}
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                done && "bg-indigo-600 text-white",
                current && "bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-400/30",
                !done && !current && "bg-secondary text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : current ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn("text-[12.5px] font-semibold", done || current ? "text-foreground" : "text-muted-foreground")}>
              {label}
              <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const TONE_CHIP: Record<Tone, string> = {
  progress: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  error: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  info: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
};

export function PaymentReturn() {
  const { user, loading } = useUser();
  const [reference, setReference] = useState<string | null | undefined>(undefined);
  useEffect(() => setReference(readReference()), []);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState(0);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (!reference || inflight.current) return null; // one request at a time, never a pile-up
    const ac = new AbortController();
    inflight.current = ac;
    setChecking(true);
    try {
      const res = await fetch(`/api/ads/payment/${encodeURIComponent(reference)}`, { cache: "no-store", signal: ac.signal });
      const json = (await res.json().catch(() => null)) as (View & { error?: string; message?: string }) | null;
      if (!res.ok || !json) {
        setError(json?.message ?? adMessage("server"));
        return null;
      }
      setError(null);
      setView(json);
      return json;
    } catch (e) {
      if (ac.signal.aborted) return null; // the page left — say nothing
      void e;
      setError("You appear to be offline. Your payment is safe — check again when you're back online.");
      return null;
    } finally {
      if (inflight.current === ac) inflight.current = null;
      if (!ac.signal.aborted) {
        setChecking(false);
        setChecks((n) => n + 1);
      }
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
      inflight.current?.abort();
      inflight.current = null;
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

  if (reference === undefined || (reference && loading)) return <ReturnSkeleton />;
  if (!reference) return <Notice icon={CircleAlert} tone="rose">{adMessage("payment_not_found")}</Notice>;
  if (!user) {
    return (
      <AiPanel className="text-center dark:ring-white/10">
        <p className="text-[15px] font-semibold">Sign in to see your payment</p>
        <TapOnceLink href={`/login?next=${encodeURIComponent(`/advertise/payment?reference=${reference}`)}`} className="ai-btn ai-btn--primary mt-4 inline-flex">
          Sign in
        </TapOnceLink>
      </AiPanel>
    );
  }
  if (!view && !error) return <ReturnSkeleton />;

  const state = view?.state ?? "verifying";
  const gaveUp = SETTLING.includes(state) && checks >= BACKOFF_MS.length;
  const copy = copyFor(state, view?.paymentStatus ?? null, gaveUp);
  const settlingNow = SETTLING.includes(state) && !gaveUp && view?.paymentStatus !== "verification_required";
  const live = state === "live";
  const first = view?.campaigns[0] ?? null;
  const amount = view ? formatMoney(view.amountUsdCents, "USD") : null;
  const local = view && view.providerCurrency && view.providerCurrency !== "USD" && view.providerAmount !== null ? formatMoney(view.providerAmount, view.providerCurrency as "NGN") : null;
  /** "Paid" is the server's word only — never for a payment it has not confirmed */
  const paid = view?.paymentStatus === "success";
  const ends = view?.campaigns.map((c) => c.endAt).filter(Boolean).sort().at(-1) ?? null;
  const Icon = copy.tone === "success" ? BadgeCheck : copy.tone === "progress" ? LoaderCircle : copy.tone === "info" ? ShieldCheck : copy.tone === "warn" ? Clock : CircleAlert;

  return (
    <div>
      <AdFlowRail phase="payment" />

      {/* one status block; only it changes as the answer arrives (§68: never the whole page) */}
      <div key={`${state}-${copy.title}`} className="mt-5 duration-200 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none" role="status" aria-live="polite">
        <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", TONE_CHIP[copy.tone])} aria-hidden>
          <Icon className={cn("h-6 w-6", copy.tone === "progress" && "animate-spin motion-reduce:animate-none")} />
        </span>
        <h1 className="mt-3 font-brand text-[1.6rem] font-bold leading-tight tracking-[-0.03em]">{copy.title}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{copy.body}</p>
        {settlingNow || state === "paid" || state === "activating" || live ? <Progress state={state} /> : null}
      </div>

      {error ? (
        <div className="mt-4">
          <Notice icon={CircleAlert} tone="rose">
            {error}
          </Notice>
        </div>
      ) : null}

      {view?.extension ? (
        <div className="mt-4">
          <Notice icon={view.extension.status === "applied" ? BadgeCheck : Clock} tone={view.extension.status === "applied" ? "emerald" : "amber"}>
            {view.extension.status === "applied"
              ? `Campaign extended by ${view.extension.days + view.extension.extraDays} days${view.extension.newEndAt ? ` — it now runs until ${new Date(view.extension.newEndAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}.`
              : view.extension.status === "held"
                ? "We received your payment, but the campaign had stopped before it arrived. Our team will contact you."
                : "Your extension starts as soon as the payment is confirmed."}
          </Notice>
        </div>
      ) : null}

      {view && first ? (
        <CampaignSummaryCard
          className="mt-5"
          title={live ? "Your campaign" : "Campaign summary"}
          name={view.campaigns.length === 1 ? first.name : null}
          placements={view.campaigns.map((c) => c.placement ?? "—")}
          format={first.format ? FORMAT_LABEL[first.format] ?? first.format : null}
          runtime={runtimeLabel(first.durationDays, first.extraDays)}
          total={live ? null : amount}
          totalNote={live ? null : local}
          totalLabel={paid ? "Paid" : "Amount"}
          footer={
            live ? (
              <div className="border-t border-border/70 pt-2.5">
                <Row label="Ends" value={day(ends)} />
                <Row muted label="Paid" value={local ? `${amount} · ${local}` : amount} />
              </div>
            ) : (
              <p className="border-t border-border/70 pt-2.5 text-[11.5px] text-muted-foreground">
                Reference <span className="font-mono">{view.reference}</span>
              </p>
            )
          }
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5 min-[420px]:flex-row min-[420px]:flex-wrap">
        {settlingNow ? (
          <AiButton size="lg" block disabled aria-busy iconEnd={<LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />}>
            {state === "verifying" ? "Verifying Payment…" : "Activating Campaign…"}
          </AiButton>
        ) : null}
        {live ? (
          <AiButtonLink tapOnce href="/advertise/campaigns" prefetch={false} size="lg" block icon={<CalendarClock className="h-4 w-4" />}>
            View Campaign
          </AiButtonLink>
        ) : null}
        {(SETTLING.includes(state) && !settlingNow) || state === "review" || (error && SETTLING.includes(state)) ? (
          <AiButton
            size="lg"
            block
            variant={state === "review" ? "secondary" : "primary"}
            onClick={() => void check()}
            disabled={checking}
            aria-busy={checking}
            icon={checking ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}
          >
            {checking ? "Checking…" : "Check Payment Status"}
          </AiButton>
        ) : null}
        {view?.paymentStatus === "verification_required" && state === "verifying" ? (
          <AiButtonLink tapOnce href="/advertise/create" prefetch={false} variant="secondary" size="lg" block>
            Try Again
          </AiButtonLink>
        ) : null}
        {state === "failed" || state === "cancelled" ? (
          <AiButtonLink tapOnce href="/advertise/create" prefetch={false} size="lg" block>
            Try Payment Again
          </AiButtonLink>
        ) : null}
        {state === "expired" ? (
          <AiButtonLink tapOnce href="/advertise/create" prefetch={false} size="lg" block>
            Review Campaign
          </AiButtonLink>
        ) : null}
        {!live ? (
          <AiButtonLink tapOnce href="/advertise/campaigns" prefetch={false} variant="secondary" size="lg" block>
            My campaigns
          </AiButtonLink>
        ) : null}
      </div>
    </div>
  );
}

/** The status block and the summary card's shape, so the answer arrives without a jump (§67). */
function ReturnSkeleton() {
  return (
    <div aria-busy className="animate-pulse motion-reduce:animate-none">
      <span className="block h-[50px] rounded-xl bg-secondary/70" />
      <span className="mt-5 block h-12 w-12 rounded-2xl bg-secondary" />
      <span className="mt-3 block h-8 w-2/3 rounded-full bg-secondary" />
      <span className="mt-2 block h-4 w-4/5 rounded-full bg-muted" />
      <span className="mt-5 block h-48 rounded-[1.75rem] bg-muted" />
      <span className="mt-5 block h-[3.375rem] rounded-2xl bg-secondary" />
    </div>
  );
}
