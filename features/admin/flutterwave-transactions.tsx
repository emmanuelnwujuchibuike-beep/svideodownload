"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSensitiveAction } from "@/features/admin/use-sensitive-action";
import { cn } from "@/lib/utils";

/**
 * Part 5 — Admin → Flutterwave: "Test connection" and the payments table with a per-row "Recheck"
 * (app/api/admin/flutterwave/test, app/api/admin/flutterwave/transactions). The page shows what the server's ledgers
 * say; it never marks anything paid. Recheck sends a REFERENCE only: the server asks the provider and settles through
 * the existing idempotent path, so a double click or a parallel webhook can't credit twice. It asks for the admin
 * password again (like saving the keys).
 */

interface TxRow {
  source: "ai_topup_attempts" | "sub_purchases" | "verification_purchases";
  reference: string;
  provider: string;
  purpose: string;
  status: string;
  state: "settled" | "open" | "needs_check" | "review" | "closed";
  amountMinor: number | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string | null;
  reason: string | null;
  hasCheckoutLink: boolean;
  userId: string | null;
}
interface ProviderEvent {
  provider: string;
  eventType: string;
  reference: string | null;
  receivedAt: string;
  processedAt: string | null;
  outcome: string | null;
}

const PURPOSES: { id: string; label: string }[] = [
  { id: "", label: "All purposes" },
  { id: "wallet_topup", label: "AI credit top-ups" },
  // Part 4.1: a member's Frenz Coin deposit (their money on hold in their wallet — not AI credits, not revenue)
  { id: "coin_deposit", label: "Frenz Coin deposits" },
  { id: "ai_subscription", label: "AI plans" },
  { id: "site_subscription", label: "Pro / Business" },
  { id: "ad_campaign", label: "Ad campaigns" },
  { id: "sub_purchase", label: "Creator subscriptions" },
  { id: "verification", label: "Paid verification" },
];
const STATES: { id: string; label: string }[] = [
  { id: "", label: "Any state" },
  { id: "needs_check", label: "Needs a check" },
  { id: "open", label: "Open (awaiting payment)" },
  { id: "review", label: "Held for review" },
  { id: "settled", label: "Settled" },
  { id: "closed", label: "Closed (failed / abandoned / refunded)" },
];
const STATE_STYLE: Record<TxRow["state"], string> = {
  settled: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  open: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  needs_check: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  review: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  closed: "bg-secondary text-muted-foreground",
};
const RECHECKABLE: ReadonlySet<TxRow["state"]> = new Set(["open", "needs_check"]);
const money = (minor: number | null, currency: string | null) => (minor === null || !currency ? "" : `${currency} ${(minor / 100).toFixed(2)}`);

export function FlutterwaveConnectionTest() {
  const [state, setState] = useState<{ busy: boolean; ok: boolean | null; text: string | null }>({ busy: false, ok: null, text: null });
  const run = async () => {
    setState({ busy: true, ok: null, text: null });
    try {
      const res = await fetch("/api/admin/flutterwave/test", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; mode?: string | null };
      setState({ busy: false, ok: res.ok && json.ok === true, text: json.message ? `${json.message}${json.mode ? ` (${json.mode} key)` : ""}` : (json.error ?? "Couldn't run the test.") });
    } catch {
      setState({ busy: false, ok: false, text: "Network error." });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void run()} disabled={state.busy} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-60">
        {state.busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
        Test connection
      </button>
      {state.text ? <span className={cn("text-xs font-medium", state.ok ? "text-green-500" : "text-red-400")}>{state.text}</span> : null}
    </div>
  );
}

export function FlutterwaveTransactions() {
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [provider, setProvider] = useState("");
  const [purpose, setPurpose] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [reference, setReference] = useState("");
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [events, setEvents] = useState<ProviderEvent[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (provider) q.set("provider", provider);
      if (purpose) q.set("purpose", purpose);
      if (stateFilter) q.set("state", stateFilter);
      if (reference.trim()) q.set("reference", reference.trim());
      const res = await fetch(`/api/admin/flutterwave/transactions?${q.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { rows?: TxRow[]; events?: ProviderEvent[]; unavailable?: string[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Couldn't load payments.");
        return;
      }
      setRows(json.rows ?? []);
      setEvents(json.events ?? []);
      setUnavailable(json.unavailable ?? []);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [provider, purpose, stateFilter, reference]);
  useEffect(() => void load(), [load]);

  const recheck = async (ref: string) => {
    setBusyRef(ref);
    setNotice(null);
    setError(null);
    try {
      const res = await sensitiveFetch("/api/admin/flutterwave/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: ref }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; before?: string; after?: string; outcome?: string };
      if (!res.ok) setError(json.error ?? "Couldn't recheck it.");
      else setNotice(json.before === json.after ? `Rechecked ${ref}: still ${json.after} (${json.outcome}).` : `Rechecked ${ref}: ${json.before} → ${json.after}.`);
      await load();
    } finally {
      setBusyRef(null);
    }
  };

  const select = "h-9 rounded-xl bg-background px-2 text-sm ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  return (
    <div className="mt-5 space-y-3 border-t border-border/50 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Payments and reconciliation</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="sr-only" htmlFor="fw-tx-provider">Provider</label>
        <select id="fw-tx-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={select}>
          <option value="">Both providers</option>
          <option value="flutterwave">Flutterwave</option>
          <option value="paystack">Paystack</option>
        </select>
        <label className="sr-only" htmlFor="fw-tx-purpose">Purpose</label>
        <select id="fw-tx-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={select}>
          {PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="fw-tx-state">Reconciliation state</label>
        <select id="fw-tx-state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={select}>
          {STATES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="fw-tx-ref">Reference</label>
        <input id="fw-tx-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="frenz_… reference" spellCheck={false} className={cn(select, "font-mono text-xs")} />
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-600 dark:text-emerald-300">{notice}</p> : null}
      {unavailable.length ? <p className="text-[11px] text-amber-600">Not readable right now (a migration may be pending): {unavailable.join(", ")}.</p> : null}
      {rows && !rows.length ? <p className="text-xs text-muted-foreground">No payments match.</p> : null}
      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={`${r.source}:${r.reference}`} className="rounded-xl border border-border/70 p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {PURPOSES.find((p) => p.id === r.purpose)?.label ?? r.purpose} · {r.provider}
                {money(r.amountMinor, r.currency) ? ` · ${money(r.amountMinor, r.currency)}` : ""}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 font-semibold", STATE_STYLE[r.state])}>
                {STATES.find((s) => s.id === r.state)?.label ?? r.state}
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {r.reference} · status {r.status}
              {r.reason ? ` · ${r.reason}` : ""}
              {r.hasCheckoutLink ? " · link handed out" : " · no link"}
              {r.userId ? ` · member ${r.userId.slice(0, 8)}…` : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <span>
                {new Date(r.createdAt).toLocaleString()}
                {r.updatedAt ? ` · updated ${new Date(r.updatedAt).toLocaleString()}` : ""}
              </span>
              {RECHECKABLE.has(r.state) ? (
                <button type="button" disabled={busyRef === r.reference} onClick={() => void recheck(r.reference)} className="rounded-lg border border-border px-2.5 py-1 font-semibold text-foreground disabled:opacity-50">
                  {busyRef === r.reference ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
                  Recheck with provider
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <details className="rounded-xl border border-border/70 p-2.5 text-xs">
        <summary className="cursor-pointer font-semibold text-muted-foreground">Provider events (webhooks) {events.length ? `(${events.length})` : ""}</summary>
        {!events.length ? <p className="mt-2 text-muted-foreground">None match.</p> : null}
        <ul className="mt-2 space-y-1">
          {events.map((e, i) => (
            <li key={`${e.provider}:${e.receivedAt}:${i}`} className="break-all font-mono text-[11px] text-muted-foreground">
              {new Date(e.receivedAt).toLocaleString()} · {e.provider} · {e.eventType}
              {e.reference ? ` · ${e.reference}` : ""} · {e.processedAt ? `processed: ${e.outcome ?? "ok"}` : "not processed"}
            </li>
          ))}
        </ul>
      </details>
      {reauthPrompt}
    </div>
  );
}
