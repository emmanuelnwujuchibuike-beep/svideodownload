"use client";

import { Loader2, Mail, Send } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";
const PERIODS: { key: Period; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

/**
 * Owner, 2026-08-16: "send a test email when done" — this is the permanent
 * form of that verification, not a one-off. `/api/cron/digest` fires the real
 * schedule; this button hits `/api/admin/digest/test` to prove the pipeline
 * (aggregation → template → Resend) works on demand, any time.
 */
export function DigestPanel() {
  const [period, setPeriod] = useState<Period>("daily");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/digest/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Failed." });
      } else {
        const warn = (json.warnings as string[] | undefined)?.length ? ` (${json.warnings.length} note${json.warnings.length > 1 ? "s" : ""} inside)` : "";
        setMsg({ ok: true, text: `Sent — check the admin inbox.${warn}` });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 font-semibold">
        <Mail className="h-5 w-5 text-primary" /> Admin digest
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Downloads, visitors, page views, ad engagement, signed-in vs. anonymous activity and new signups, rolled up
        and emailed automatically — daily every 1am UTC, weekly on Sundays, monthly on the last day of the month, all
        from the same sweep. Send a copy now to check the pipeline any time.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Digest period" className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                period === p.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test email
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </section>
  );
}
