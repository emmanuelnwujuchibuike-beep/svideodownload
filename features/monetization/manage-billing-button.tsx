"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

/**
 * Billing for a Pro / Business member: a Paystack plan opens Paystack's manage page; a Flutterwave plan
 * (no hosted manage page) asks once, then cancels future charges and keeps access to the end of the paid period.
 */
export function ManageBillingButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ periodEnd: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const call = async (action?: "cancel") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action ? { action } : {}) });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url as string;
        return;
      }
      if (json.flutterwave) {
        if (json.cancelled) setDone(`Cancelled. Your plan stays on until ${fmtDate(json.periodEnd) ?? "the end of the paid period"}.`);
        else setConfirm({ periodEnd: json.periodEnd ?? null });
        return;
      }
      if (json.ok) {
        setConfirm(null);
        setDone(`Cancelled. Your plan stays on until ${fmtDate(json.periodEnd) ?? "the end of the paid period"}.`);
        return;
      }
      setError(json.error ?? "Couldn't open billing.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (done) return <p className="text-xs text-muted-foreground">{done}</p>;

  if (confirm) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Cancel your plan? You won&apos;t be charged again, and it stays on until {fmtDate(confirm.periodEnd) ?? "the end of the paid period"}.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => call("cancel")} disabled={loading} className={className}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel plan"}
          </button>
          <button type="button" onClick={() => setConfirm(null)} disabled={loading} className="text-xs underline">
            Keep it
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => call()} disabled={loading} className={className}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </>
  );
}
