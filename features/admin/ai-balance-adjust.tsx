"use client";

import { UserRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, majorInputToMinor } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

export function AiBalanceAdjustPanel({ settings }: { settings: LandingSettings }) {
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <AdjustBalance symbol={aiCurrencySymbol(settings.frenzAiCurrency)} />
    </section>
  );
}

/* ───────────────────────── a member's balance ────────────────────────────── */

/**
 * Part 3, §22: "Admin manual balance adjustment (credit/debit with reason)".
 * POSTs to /api/admin/ai/character-replace/adjust, which writes ONE
 * `adjustment` row on the product ledger with the operator's id and reason,
 * and never touches the AI wallet. A debit that would take the balance
 * below zero is refused by the database function, and the message says so.
 */
function AdjustBalance({ symbol }: { symbol: string }) {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /*
    🔴 A REF, NOT ONLY STATE. Observed 2026-09-14: two adjustment rows one
    millisecond apart from a single press — the second submit fired before
    React had re-rendered the disabled button, so `busy` was still false for
    both. The ref flips synchronously; the second submit finds it set.
  */
  const inflight = useRef(false);

  const cents = majorInputToMinor(amount);
  const valid = email.trim().length > 3 && cents !== null && cents > 0 && note.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || cents === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ai/character-replace/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), amountCents: direction === "credit" ? cents : -cents, note: note.trim() }),
      });
      const json = (await res.json()) as { error?: string; balanceCents?: number };
      setMsg(
        res.ok && typeof json.balanceCents === "number"
          ? { ok: true, text: `Done. Their Character Replace balance is now ${formatCents(json.balanceCents, symbol)}.` }
          : { ok: false, text: json.error ?? "Failed." },
      );
      if (res.ok) {
        setAmount("");
        setNote("");
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const input =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border/70 bg-background/60 p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-primary" aria-hidden /> Adjust a member&apos;s Frenz AI balance
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The one Frenz AI balance (Character Replace), recorded with your id and the reason. Use it for goodwill, a manual
        refund, or to reverse a mistaken credit — a debit of the same amount undoes a credit. Every press is a new adjustment.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id="cr-adjust-email" label="Member email">
          <input id="cr-adjust-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </Field>
        <Field id="cr-adjust-amount" label={`Amount (${symbol})`}>
          <div className="mt-1 flex gap-2">
            <select value={direction} onChange={(e) => setDirection(e.target.value as "credit" | "debit")} aria-label="Direction" className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
            <input id="cr-adjust-amount" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(input, "mt-0")} />
          </div>
        </Field>
      </div>
      <Field id="cr-adjust-note" label="Reason" className="mt-4">
        <input id="cr-adjust-note" type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill after a failed run on 13 Sep" className={input} />
      </Field>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={busy || !valid} className="btn-lux border border-border bg-background text-foreground disabled:opacity-50">
          {busy ? "Applying…" : direction === "credit" ? "Credit balance" : "Debit balance"}
        </button>
        {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-500")}>{msg.text}</p> : null}
      </div>
    </form>
  );
}


function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}
